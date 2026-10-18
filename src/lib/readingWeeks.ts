/**
 * Juz of reading per calendar week, for the Insights "Reading per week"
 * card. Native-only (2026-10-18): the web app is frozen, so there is no web
 * twin to keep in step. Pure, no React, node-testable.
 *
 * Only reading-style entries count (Reading, and legacy Revising, which is
 * re-reading): the question it answers is "am I reading a juz a week", and
 * Sabak, Sabak Para and Dhor are memorization, which has its own card.
 */

import {
  addWeeks,
  localDate,
  shortDate,
  startOfWeek,
  weekDatesUpTo,
  weekRangeLabel,
} from "@/lib/dates";
import { isReadingType, type EntryType } from "@/lib/entries";

/** pages_equiv is in 15-line Uthmani pages whatever the print (DECISIONS
 *  § Logging: juz x20), so a juz is 20 of them for every mushaf. */
export const PAGES_PER_JUZ = 20;

export type ReadingWeekRow = {
  entry_type: EntryType;
  logged_at: string;
  pages_equiv: number | null;
};

export type ReadingWeek = {
  /** Short x-axis label: the week's Monday ("6 Oct"). */
  label: string;
  /** Tooltip label: "6 Oct to 12 Oct", or "... · so far" for this week. */
  full: string;
  juz: number;
};

export type ReadingJuzWeeks = {
  /** Oldest first; the last one is the current week, Monday to today. */
  weeks: ReadingWeek[];
  thisWeek: number;
  /** Mean juz across the finished weeks in the window, counting from the
   *  week of the first reading entry ever (weeks before it aren't slow
   *  weeks, they're weeks before this person read here). Null until one
   *  such week has finished. */
  average: number | null;
  /** Finished weeks behind `average`. */
  counted: number;
  /** Of those, the weeks that reached `goal`. */
  reached: number;
  /** Any reading entry at all, ever. */
  any: boolean;
};

const r2 = (n: number) => +n.toFixed(2);

export function readingJuzWeeks(
  rows: ReadingWeekRow[],
  tz: string,
  today: string,
  weeks = 8,
  goal = 1,
): ReadingJuzWeeks {
  const firstMonday = addWeeks(today, -(weeks - 1));
  const pages = new Map<string, number>();
  let firstRead: string | null = null;
  for (const r of rows) {
    if (!isReadingType(r.entry_type)) continue;
    const date = localDate(r.logged_at, tz);
    if (firstRead == null || date < firstRead) firstRead = date;
    const p = r.pages_equiv ? +r.pages_equiv : 0;
    if (!p) continue;
    const monday = startOfWeek(date);
    if (monday < firstMonday) continue;
    pages.set(monday, (pages.get(monday) ?? 0) + p);
  }

  const out: ReadingWeek[] = [];
  const finished: number[] = [];
  const firstWeek = firstRead == null ? null : startOfWeek(firstRead);
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = addWeeks(today, -w);
    const dates = weekDatesUpTo(monday, today);
    const range = weekRangeLabel(monday, dates[dates.length - 1]);
    const juz = r2((pages.get(monday) ?? 0) / PAGES_PER_JUZ);
    out.push({
      label: shortDate(monday),
      full: w === 0 ? `${range} · so far` : range,
      juz,
    });
    if (w > 0 && firstWeek != null && monday >= firstWeek) finished.push(juz);
  }

  return {
    weeks: out,
    thisWeek: out[out.length - 1].juz,
    average: finished.length
      ? r2(finished.reduce((s, j) => s + j, 0) / finished.length)
      : null,
    counted: finished.length,
    // Compare at the shown precision, so a week labelled "1 juz" counts.
    reached: finished.filter((j) => j >= goal).length,
    any: firstRead != null,
  };
}
