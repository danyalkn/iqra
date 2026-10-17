import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useOutbox } from "@/hooks/use-outbox";
import { useSession } from "@/providers/SessionProvider";

import { syncOutbox } from "./sync";

/**
 * Headless component in the root layout (beside PushController) that keeps
 * the outbox moving (docs/NEXT-SESSION.md "Sync triggers"): a sync when a
 * member is signed in, on every return to the foreground, and on a backoff
 * timer while entries wait and the app is on screen. The other triggers
 * live with their callers: a new entry (Today), a Today load that landed,
 * and the end of a log from a notification button (src/push/actions.ts).
 *
 * No reachability listener: that needs expo-network, a native module, and
 * a failed request is signal enough. The timer covers the gap.
 */

/** First retry after a failed run, doubling to the cap. */
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

export function SyncController() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { items } = useOutbox(userId);
  // Discards count: they still owe the server a delete.
  const waiting = items.filter((i) => i.state === "pending").length;
  const delay = useRef(BACKOFF_START_MS);

  useEffect(() => {
    if (!userId) return;
    void syncOutbox(userId);
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      delay.current = BACKOFF_START_MS;
      void syncOutbox(userId);
    });
    return () => sub.remove();
  }, [userId]);

  useEffect(() => {
    if (!userId || waiting === 0) {
      delay.current = BACKOFF_START_MS;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        // Suspended apps do not run timers anyway; this skips the odd tick
        // that fires while the app is on its way out.
        if (AppState.currentState === "active") {
          const result = await syncOutbox(userId);
          if (cancelled) return;
          // Offline, or a server that keeps saying "later" (5xx, schema
          // cache): back off either way; anything settled starts over.
          delay.current = result.progressed
            ? BACKOFF_START_MS
            : Math.min(delay.current * 2, BACKOFF_MAX_MS);
        }
        schedule();
      }, delay.current);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId, waiting]);

  return null;
}
