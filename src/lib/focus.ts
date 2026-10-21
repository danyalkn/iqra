import { localDate, nextYmd, zonedIso } from "./dates";

/**
 * Focus: the member's chosen apps stay blocked on their own phone until
 * they have logged today's Quran (docs/FOCUS.md, docs/DECISIONS.md
 * "Focus"). This file is the rule only; the native side lives in src/focus.
 *
 * "Logged today" is the streak's rule: an entry dated today in the
 * profile's time zone, of any type. A backdated entry ("Saved to
 * yesterday", possible until 3 AM) sets yesterday and does not unlock.
 * "Paused" is for one profile-local day; the block comes back the next
 * morning on its own.
 */
export type FocusState = {
  enabled: boolean;
  /** Profile-local date (YYYY-MM-DD) of the newest entry this phone knows
   *  about: queued here, logged from a notification button, or loaded on
   *  Today. Never moves backwards. */
  lastLoggedDay: string | null;
  /** Profile-local date the member paused for, or null. */
  pausedDay: string | null;
};

export const FOCUS_OFF: FocusState = { enabled: false, lastLoggedDay: null, pausedDay: null };

export type FocusStatus = "off" | "blocked" | "unlocked" | "paused";

/** What the member sees: logged today beats paused, paused beats blocked.
 *  A day at or after today counts, so a profile moved to a zone further
 *  west (where "today" steps back a day) never blocks a day already
 *  logged. */
export function focusStatus(s: FocusState, today: string): FocusStatus {
  if (!s.enabled) return "off";
  if (s.lastLoggedDay && s.lastLoggedDay >= today) return "unlocked";
  if (s.pausedDay && s.pausedDay >= today) return "paused";
  return "blocked";
}

/** True when the shield should be down right now (`today` is the
 *  profile-local date, `todayLocal(tz)`). Off means down. */
export function focusUnlocked(s: FocusState, today: string): boolean {
  return focusStatus(s, today) !== "blocked";
}

/** The state after an entry dated `day` (YYYY-MM-DD, profile-local). A
 *  backdated entry after today's never moves the day back. */
export function withLoggedDay(s: FocusState, day: string): FocusState {
  if (s.lastLoggedDay && s.lastLoggedDay >= day) return s;
  return { ...s, lastLoggedDay: day };
}

/** Milliseconds from `now` to the next profile-local midnight, so a timer
 *  can re-check the rule while the app stays open across the day change.
 *  Never less than a second, so a timer armed at the boundary cannot spin. */
export function msUntilNextMidnight(now: number, tz: string): number {
  const next = zonedIso(nextYmd(localDate(now, tz)), 0, tz);
  return Math.max(1000, new Date(next).getTime() - now);
}

export type SelectionCounts = {
  applicationCount: number;
  categoryCount: number;
  webDomainCount: number;
};

/** "3 apps, 1 category": Iqra only ever learns counts, never names
 *  (opaque tokens, docs/SCREEN-TIME.md). Empty string for nothing picked. */
export function selectionSummary(m: SelectionCounts): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(m.applicationCount, "app", "apps");
  add(m.categoryCount, "category", "categories");
  add(m.webDomainCount, "website", "websites");
  return parts.join(", ");
}
