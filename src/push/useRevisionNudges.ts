import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

import type { RevisionItem } from "@/lib/revisionPlan";

import {
  cancelRevisionNudges,
  revisionSlots,
  scheduleRevisionSlots,
  type RevisionSlot,
} from "./revisionNudge";

/**
 * Keeps the scheduled revision nudges in step with Today. Keyed on the
 * projected week itself, so logging a reading or any render that leaves the
 * week unchanged schedules nothing; a new day, a revision or a hidden row
 * does. Runs on focus as well, which picks up the Settings switch turning
 * push on. A separate file from revisionNudge.ts so the headless log path
 * (actions.ts, loaded first from index.js) never pulls in React or the
 * router.
 *
 * `plan` (or `hiddenToday`) null means "not known yet": first load pending,
 * the full hifz history unavailable, profile not loaded. The schedule
 * already on the device is then left alone rather than wiped; a known
 * non-hifz mode cancels it.
 */
export function useRevisionNudges({
  userId,
  hifz,
  plan,
  today,
  hiddenToday,
}: {
  userId: string | null;
  hifz: boolean;
  plan: RevisionItem[] | null;
  today: string;
  hiddenToday: number[] | null;
}): void {
  const key = !userId
    ? "off"
    : plan == null || hiddenToday == null
      ? null
      : !hifz
        ? "off"
        : JSON.stringify(revisionSlots(plan, today, hiddenToday));

  useFocusEffect(
    useCallback(() => {
      if (key == null) return;
      if (key === "off" || !userId) {
        void cancelRevisionNudges();
        return;
      }
      void scheduleRevisionSlots(userId, JSON.parse(key) as RevisionSlot[]);
    }, [key, userId]),
  );
}
