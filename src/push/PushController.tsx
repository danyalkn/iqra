import * as Notifications from "expo-notifications";
import { router, useRootNavigationState, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { toNativeHref } from "@/lib/deepLinks";
import { useSession } from "@/providers/SessionProvider";
import { isChatVisible } from "@/push/chatVisibility";
import { syncPush } from "@/push/register";

/**
 * Headless component mounted once in the root layout, inside SessionProvider
 * (docs/PHASE3.md "Client"). It owns everything push-related that must
 * outlive route changes:
 *
 *  - the foreground handler (module scope, below): every push shows as a
 *    banner except a chat message while the Chat tab is on screen and the
 *    app is active, which is what "the chat is open" means to a reader;
 *    mention and reply pushes carry the same `chat-<group>` tag and are
 *    suppressed with the rest. Nudges (`nudge`) and reminders always show.
 *  - tap routing: the push `url` (a web-style path such as
 *    `/today?log=sabak&r=<id>` or `/stats#recap`) is mapped by toNativeHref
 *    and held until the auth gate is open, so a cold start from a tap while
 *    signed out survives the login instead of being dropped (the Phase 0
 *    known gap). Warm taps arrive through the response listener; the cold
 *    start through useLastNotificationResponse. The two overlap, so every
 *    response is deduped by its request identifier.
 *  - the launch / sign-in self-heal: re-register this device's token for a
 *    member who turned push on here (the web's syncPushSubscription).
 */

const CHAT_TAG_PREFIX = "chat-";

/** Fast and synchronous-ish: expo-notifications presents the notification
 *  itself if this takes over 3 s, so nothing here waits on the network. */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const tag = notification.request.content.data?.tag;
    const suppress =
      typeof tag === "string" &&
      tag.startsWith(CHAT_TAG_PREFIX) &&
      isChatVisible() &&
      AppState.currentState === "active";
    return {
      shouldShowBanner: !suppress,
      shouldShowList: !suppress,
      // Android drops the heads-up alert when sound is off (SDK 58 docs), and
      // a reminder arriving while the app is open should still be heard.
      shouldPlaySound: !suppress,
      shouldSetBadge: false,
    };
  },
});

/** Responses already acted on this launch. The cold-start hook re-delivers
 *  its value on every remount and the warm listener can see the same tap. */
const handled = new Set<string>();

/** The in-app href a notification response asks for, or null for a response
 *  with no usable url (a bare action, a foreign payload). */
export function hrefFromResponse(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data;
  const url = data?.url;
  return toNativeHref(typeof url === "string" ? url : null);
}

export function PushController() {
  const { loading, session, isOnboarded, user } = useSession();
  const userId = user?.id ?? null;
  const navReady = !!useRootNavigationState()?.key;
  const gateOpen = !loading && !!session && isOnboarded;

  // The href waiting for the gate. Kept in memory only: a kill mid-login
  // loses it, which is acceptable for a five-person circle (PHASE3.md). A
  // ref plus a wake counter rather than state, so discarding it never sets
  // state inside an effect.
  const pending = useRef<string | null>(null);
  const [wake, setWake] = useState(0);

  const last = Notifications.useLastNotificationResponse();

  // One place for both delivery paths.
  const onResponse = useRef((response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    if (handled.has(id)) return;
    handled.add(id);
    // Body tap (or any action without its own handling yet): route.
    const href = hrefFromResponse(response);
    if (!href) return;
    pending.current = href;
    setWake((n) => n + 1);
  });

  useEffect(() => {
    if (last) onResponse.current(last);
  }, [last]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => onResponse.current(r));
    return () => sub.remove();
  }, []);

  // Deliver once the gate is open and the navigator exists. `index` has
  // already redirected to /today by then, so this is a push, never a
  // replace, and a /today?log=... link lands on the Today tab with its
  // params (Today consumes them once and clears them).
  useEffect(() => {
    if (!pending.current || !gateOpen || !navReady) return;
    // Next tick: let the gate's own redirect settle before stacking a push.
    const t = setTimeout(() => {
      const href = pending.current;
      pending.current = null;
      if (!href) return;
      try {
        router.push(href as Href);
      } catch (e) {
        console.warn("Push deep link failed", href, e);
      }
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [wake, gateOpen, navReady]);

  // Sign-out drops whatever was waiting: the next member to sign in must
  // not inherit a link meant for the previous one. (Signed out at tap time
  // is different: userId was already null, nothing is discarded, and the
  // link survives the login as intended.)
  const prevUser = useRef(userId);
  useEffect(() => {
    if (prevUser.current && !userId) {
      pending.current = null;
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }
    prevUser.current = userId;
  }, [userId]);

  // Launch and sign-in self-heal (token rotation, pruned rows).
  useEffect(() => {
    if (userId) void syncPush(userId);
  }, [userId]);

  return null;
}
