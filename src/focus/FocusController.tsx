import { useEffect } from "react";
import { AppState } from "react-native";

import { msUntilNextMidnight } from "@/lib/focus";

import { reconcileFocus } from "./controls";
import { focusAvailable } from "./focus";
import { useFocusContext } from "./useFocusContext";

/**
 * Headless component in the root layout, beside SyncController, that keeps
 * the phone's shield in step with the Focus rule (docs/FOCUS.md § 4):
 *
 *  - when a member is known (launch, sign-in), which also turns off a
 *    block left behind by another account on this phone;
 *  - on every return to the foreground, which covers the first open after
 *    midnight and a Screen Time change made in iOS Settings (seen only
 *    after a restart, so the card says to reopen Iqra);
 *  - at the next profile-local midnight while the app stays open, the way
 *    Today's clock moves "today" on.
 *
 * The unlock on a new entry is not here: Today and the notification
 * buttons call noteLogged where they enqueue (src/focus/controls.ts).
 * Nothing runs off iOS.
 */
export function FocusController() {
  const ctx = useFocusContext();

  useEffect(() => {
    if (!ctx || !focusAvailable()) return;
    void reconcileFocus(ctx);

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void reconcileFocus(ctx);
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      timer = setTimeout(() => {
        void reconcileFocus(ctx);
        arm();
      }, msUntilNextMidnight(Date.now(), ctx.tz) + 1000);
    };
    arm();

    return () => {
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [ctx]);

  return null;
}
