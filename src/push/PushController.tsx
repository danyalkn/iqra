import * as Notifications from "expo-notifications";
import { router, useRootNavigationState, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import { useSession } from "@/providers/SessionProvider";
import {
  logInBackground,
  parseResponse,
  responseKey,
  sheetHref,
  wasLogged,
} from "@/push/actions";
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
 *    response is deduped by its per-push key (see responseKey: the request
 *    identifier alone repeats across pushes with one collapse id / tag).
 *  - action buttons on reminders (logReading / logHifz categories): a tap
 *    while the app is on screen opens the log sheet prefilled with the type
 *    and amount (`/today?log=<type>&amount=<n>`). A tap with the app in the
 *    background or killed is written headless: on Android by the task in
 *    src/push/task.ts (this component stays out of its way), on iOS here,
 *    because the actions do not open the app and the system wakes or
 *    launches it in the background with the response (categories.ts).
 *    Responses already logged are never replayed into the sheet.
 *  - the launch / sign-in self-heal: re-register this device's token for a
 *    member who turned push on here (the web's syncPushSubscription).
 *
 * No React state: the waiting href lives in a ref and delivery is a plain
 * function called from the listener and from the effect that watches the
 * gate, so nothing sets state inside an effect.
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
  const ready = !loading && !!session && isOnboarded && navReady;

  // The href waiting for the gate. Kept in memory only: a kill mid-login
  // loses it, which is acceptable for a five-person circle (PHASE3.md).
  const pending = useRef<string | null>(null);
  const readyRef = useRef(ready);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deliver once the gate is open and the navigator exists. `index` has
  // already redirected to /today by then, so this is a push, never a
  // replace, and a /today?log=... link lands on the Today tab with its
  // params (Today consumes them once and clears them). Next tick, so the
  // gate's own redirect settles before a push is stacked on it.
  const deliver = useRef(() => {
    if (!pending.current || !readyRef.current || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
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
  });

  useEffect(() => {
    readyRef.current = ready;
    if (ready) deliver.current();
  }, [ready]);

  // One place for both delivery paths.
  const onResponse = useRef((response: Notifications.NotificationResponse) => {
    const key = responseKey(response);
    if (handled.has(key)) return;
    handled.add(key);
    const queue = (href: string) => {
      pending.current = href;
      deliver.current();
    };
    const parsed = parseResponse(response);
    if (parsed.kind === "open") {
      if (parsed.href) queue(parsed.href);
      return;
    }
    // A log button (or "Other amount" with text that is not a number).
    // Not "active" includes Notification Center pulled over the open app
    // ("inactive"): the button then logs as it would from the lock screen.
    if (AppState.currentState !== "active") {
      // Android: the task owns the write and this listener may still fire
      // alongside it; stay out of its way. iOS: nobody else will, and the
      // app is not on screen to show a sheet, so write it here.
      if (Platform.OS === "ios") void logInBackground(response, parsed);
      return;
    }
    if (parsed.kind === "invalidAmount") {
      queue(sheetHref(parsed.type, null, parsed.reminderId));
      return;
    }
    // Already written headless (a cold start replaying that response).
    void wasLogged(key).then((done) => {
      if (!done) queue(sheetHref(parsed.type, parsed.amount, parsed.reminderId));
    });
  });

  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (last) onResponse.current(last);
  }, [last]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => onResponse.current(r));
    return () => sub.remove();
  }, []);

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

  // Launch and sign-in self-heal (token rotation, pruned rows). A
  // background launch (an iOS action tap) has seconds before suspension
  // and spends them on the entry; the self-heal waits for the app to open.
  useEffect(() => {
    if (!userId) return;
    if (AppState.currentState === "active") {
      void syncPush(userId);
      return;
    }
    let done = false;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || done) return;
      done = true;
      void syncPush(userId);
    });
    return () => sub.remove();
  }, [userId]);

  return null;
}
