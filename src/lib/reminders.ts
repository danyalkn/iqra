/** Helpers for reminders: the recurring time + days-of-week kind (display)
 *  and the one-time day kind (presets, validation, status). */

import { localDate, localHm, nextYmd, zonedIso } from "@/lib/dates";
import type { DayReminder, LogRow } from "@/lib/types";

export const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"]; // 0=Sun
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** "6:00 AM" from a Postgres time string ("HH:MM" or "HH:MM:SS"). */
export function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Daily" / "Weekdays" / "Weekends" / "Mon, Wed, Fri". */
export function daysSummary(days: number[]): string {
  if (days.length === 0) return "Never";
  const sorted = [...days].sort((a, b) => a - b);
  if (sameSet(sorted, ALL)) return "Daily";
  if (sameSet(sorted, WEEKDAYS)) return "Weekdays";
  if (sameSet(sorted, WEEKENDS)) return "Weekends";
  return sorted.map((d) => DAY_SHORT[d]).join(", ");
}

/* ── One-time day reminders ─────────────────────────────────────────────────
 * Set from the Today page for later today or tomorrow. Pure helpers so the
 * client and the SQL job (cron_send_day_reminders) can be checked against
 * each other line by line. Dates are profile-local "YYYY-MM-DD" strings,
 * pinned when the sheet opens, so a save that straddles midnight still lands
 * on the day the member was looking at. */

export type DayReminderPreset = {
  label: string;
  ymd: string; // profile-local date
  time: string; // "HH:MM"
};

export type DayReminderStatus = "pending" | "due" | "sent" | "logged";

const FIVE_MIN = 5 * 60_000;

/** Quick picks computed from "now" in the profile timezone. Relative picks
 *  round UP to the next 5 minutes so the stored time looks intentional and
 *  matches the minute-level job. A pick past tomorrow is dropped; the last
 *  pick is whichever anchor is still ahead (tonight, else tomorrow morning). */
export function dayReminderPresets(
  nowMs: number,
  tz: string,
): DayReminderPreset[] {
  const today = localDate(nowMs, tz);
  const tomorrow = nextYmd(today);
  const out: DayReminderPreset[] = [];
  const relative = (minutes: number, label: string) => {
    const at = Math.ceil((nowMs + minutes * 60_000) / FIVE_MIN) * FIVE_MIN;
    const ymd = localDate(at, tz);
    if (ymd !== today && ymd !== tomorrow) return;
    const time = localHm(at, tz);
    // Fall-back night: a wall time in the repeated hour happens twice, and
    // the server pins it to the second occurrence. A pick that means the
    // FIRST one would fire an hour late, so it is simply not offered.
    const firstOfTwo =
      localDate(at + 3_600_000, tz) === ymd && localHm(at + 3_600_000, tz) === time;
    if (firstOfTwo) return;
    out.push({ label, ymd, time });
  };
  relative(30, "In 30 min");
  relative(60, "In 1 hour");
  relative(120, "In 2 hours");
  const anchor: DayReminderPreset =
    localHm(nowMs, tz) < "21:00"
      ? { label: "Tonight 9 PM", ymd: today, time: "21:00" }
      : { label: "Tomorrow 7 AM", ymd: tomorrow, time: "07:00" };
  if (!out.some((p) => p.ymd === anchor.ymd && p.time === anchor.time)) {
    out.push(anchor);
  }
  return out;
}

/** Client-side mirror of the insert trigger: the chosen wall-clock moment,
 *  read in the profile timezone, must still be ahead of the clock. Compares
 *  instants, so it stays right across midnight and DST. (The trigger allows
 *  two minutes of slack; the client is simply strict.) */
export function dayReminderInFuture(
  ymd: string,
  time: string,
  nowMs: number,
  tz: string,
): boolean {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return false;
  return new Date(zonedIso(ymd, h, tz, m)).getTime() > nowMs;
}

/** Mirrors cron_send_day_reminders(): a reminder FOR a type counts as done
 *  once that same type is logged after the reminder was set, on the
 *  reminder's own day (so an earlier entry never silences a deliberate
 *  second round, and tonight's entry never silences tomorrow's reminder).
 *  The server marks are authoritative; the entries check is the live preview. */
export function dayReminderStatus(
  r: DayReminder,
  entries: LogRow[],
  nowMs: number,
  tz: string,
): DayReminderStatus {
  if (r.skipped_at) return "logged";
  if (r.sent_at) return "sent";
  if (r.entry_type) {
    const since = new Date(r.created_at).getTime();
    const done = entries.some(
      (e) =>
        e.entry_type === r.entry_type &&
        localDate(e.logged_at, tz) === r.remind_on &&
        new Date(e.logged_at).getTime() > since,
    );
    if (done) return "logged";
  }
  return new Date(r.due_at).getTime() <= nowMs ? "due" : "pending";
}

/** Soonest first: by local date, then wall-clock time. */
export function sortDayReminders(rs: DayReminder[]): DayReminder[] {
  return [...rs].sort(
    (a, b) =>
      a.remind_on.localeCompare(b.remind_on) || a.time.localeCompare(b.time),
  );
}
