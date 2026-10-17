import * as Notifications from "expo-notifications";
import { router, useRootNavigationState, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { useSession } from "@/providers/SessionProvider";
import { parseResponse, sheetHref, wasLogged } from "@/push/actions";
import { registerCategories } from "@/push/categories";
import { isChatVisible } from "@/push/chatVisibility";
import { syncPush } from "@/push/register";
import { registerNotificationTask } from "@/push/task";

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
 *  - action buttons on reminders (logReading / logHifz categories): a tap
 *    in the foreground, and every tap on iOS, opens the log sheet prefilled
 *    with the type and amount (`/today?log=<type>&amount=<n>`). Android
 *    taps with the app in the background are written headless by the task
 *    in src/push/task.ts; this component ignores those (and any response
 *    the task already logged) so nothing is written twice.
 *  - the launch / sign-in self-heal: re-register this device's token for a
 *    member who turned push on here (the web's syncPushSubscription).
 */

// Categories are per install and the Android task must be registered every
// launch; both are idempotent and best-effort.
void registerCategories();
void registerNotificationTask();

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
    const queue = (href: string) => {
      pending.current = href;
      setWake((n) => n + 1);
    };
    const parsed = parseResponse(response);
    if (parsed.kind === "open") {
      if (parsed.href) queue(parsed.href);
      return;
    }
    if (parsed.kind === "invalidAmount") {
      queue(sheetHref(parsed.type, null, parsed.reminderId));
      return;
    }
    // A log button. Android in the background: the task owns the write and
    // this listener may still fire alongside it; stay out of its way.
    if (Platform.OS === "android" && AppState.currentState !== "active") return;
    // Already written by the task (a cold start replaying that response).
    void wasLogged(id).then((done) => {
      if (!done) queue(sheetHref(parsed.type, parsed.amount, parsed.reminderId));
    });
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
