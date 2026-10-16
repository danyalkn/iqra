/**
 * Group khatmah math - pure, node-testable, no React.
 *
 * The circle reads "together": every member's page-bearing entry (any type)
 * adds to one running total, and every 604 Uthmani pages is one khatmah.
 * This module turns that running total into things people can picture:
 * which khatmah we are on, which juz of it we have reached, and how long
 * each finished khatmah took.
 */

import { juzForPage, juzStartPages, totalPages } from "@/lib/mushaf";
import { localDate } from "@/lib/dates";

/** The khatmah is always measured against the standard Uthmani mushaf. */
export const KHATMAH_MUSHAF = "uthmani15" as const;
export const KHATMAH_PAGES = totalPages(KHATMAH_MUSHAF); // 604

const round1 = (n: number) => +n.toFixed(1);

export type KhatmahRow = { logged_at: string; pages_equiv: number | null };

/** One khatmah, finished or in progress. Dates are profile-local YYYY-MM-DD. */
export type KhatmahSegment = {
  /** 1-based ordinal: Khatmah #1, #2, ... */
  n: number;
  /** Local date of the first entry that counted toward it. */
  startDate: string;
  /** Local date of the entry that crossed the finish line; null while open. */
  endDate: string | null;
  /** Calendar days from start to end (inclusive-ish: same day = 1). For the
   *  open khatmah, days from its start to `today`. */
  days: number;
  /** Pages logged inside this khatmah so far (604 when finished). */
  pages: number;
};

/** Where a page total sits inside the current khatmah. */
export type KhatmahPosition = {
  /** Pages into the current khatmah (0 .. 604). */
  pages: number;
  /** Juz that the current page falls in (1..30). */
  juz: number;
  /** Fully completed juz so far in this khatmah (0..30). */
  juzDone: number;
  /** Pages already read inside the current juz. */
  pagesIntoJuz: number;
  /** Length of the current juz in pages. */
  juzLength: number;
  /** The mushaf page the circle is on right now (1..604). */
  page: number;
  /** Pages left to finish the khatmah. */
  left: number;
  /** 0..100 */
  pct: number;
};

function dayDiff(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) /
      86_400_000,
  );
}

/**
 * Split the all-time log into khatmahs. Rows may be in any order; they are
 * sorted by `logged_at` so a backdated entry lands where it belongs. Entries
 * without a page count are ignored. The last segment is the open khatmah
 * (possibly with 0 pages, right after a finish). Returns [] when nothing has
 * been logged.
 */
export function splitKhatmahs(
  rows: KhatmahRow[],
  tz: string,
  today: string,
): KhatmahSegment[] {
  const sorted = rows
    .filter((r) => r.pages_equiv != null && +r.pages_equiv > 0)
    .map((r) => ({ t: r.logged_at, p: +r.pages_equiv! }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  if (sorted.length === 0) return [];

  const out: KhatmahSegment[] = [];
  let cum = 0;
  let n = 1;
  let startDate = localDate(sorted[0].t, tz);

  for (const r of sorted) {
    const before = cum;
    cum += r.p;
    // One entry can cross more than one finish line in theory (a big backfill
    // logged in a single row): close every khatmah it completes, all dated
    // to that entry. The next khatmah starts the same day.
    let crossed =
      Math.floor(cum / KHATMAH_PAGES) - Math.floor(before / KHATMAH_PAGES);
    while (crossed-- > 0) {
      const endDate = localDate(r.t, tz);
      out.push({
        n,
        startDate,
        endDate,
        days: dayDiff(startDate, endDate),
        pages: KHATMAH_PAGES,
      });
      n += 1;
      startDate = endDate;
    }
  }

  const finished = out.length;
  out.push({
    n: finished + 1,
    startDate,
    endDate: null,
    days: Math.max(0, dayDiff(startDate, today)),
    pages: round1(cum - finished * KHATMAH_PAGES),
  });
  return out;
}

/** Locate a pages-into-khatmah total on the Uthmani juz map. */
export function khatmahPosition(pagesIn: number): KhatmahPosition {
  const pages = Math.max(0, Math.min(KHATMAH_PAGES, round1(pagesIn)));
  const starts = juzStartPages(KHATMAH_MUSHAF); // 30 entries, 1-based pages
  // Pages read so far = pages 1..floor(pages); the circle is "on" the next page.
  const page = Math.min(KHATMAH_PAGES, Math.floor(pages) + 1);
  const juz = juzForPage(KHATMAH_MUSHAF, page);
  const juzStart = starts[juz - 1];
  const juzEnd = juz < 30 ? starts[juz] - 1 : KHATMAH_PAGES;
  const juzLength = juzEnd - juzStart + 1;
  const pagesIntoJuz = round1(Math.max(0, pages - (juzStart - 1)));
  // A juz counts as done once its last page has been read.
  const juzDone = pagesIntoJuz >= juzLength ? juz : juz - 1;
  return {
    pages,
    juz,
    juzDone,
    pagesIntoJuz: Math.min(pagesIntoJuz, juzLength),
    juzLength,
    page,
    left: round1(KHATMAH_PAGES - pages),
    pct: Math.min(100, (pages / KHATMAH_PAGES) * 100),
  };
}

/** Average pages per day over the trailing `windowDays` (inclusive of
 *  today), or over the days since the first entry when that's fewer - a
 *  three-day-old circle's pace is three days' pages over three days. */
export function recentPace(
  rows: KhatmahRow[],
  tz: string,
  today: string,
  windowDays = 30,
): number {
  const cutoff = new Date(`${today}T12:00:00`);
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));
  const floor = cutoff.toLocaleDateString("en-CA");
  // Rows more than a couple of days older than the window can't land in it
  // in any timezone; skip them before the (costlier) local-date conversion.
  const early = new Date(cutoff.getTime() - 2 * 86_400_000).toISOString();
  let sum = 0;
  let first: string | null = null;
  for (const r of rows) {
    if (!r.pages_equiv || !(+r.pages_equiv > 0)) continue;
    if (first == null || r.logged_at < first) first = r.logged_at;
    if (r.logged_at < early) continue;
    const d = localDate(r.logged_at, tz);
    if (d >= floor && d <= today) sum += +r.pages_equiv;
  }
  if (first == null) return 0;
  const firstDay = localDate(first, tz);
  const span = firstDay > floor ? dayDiff(firstDay, today) + 1 : windowDays;
  return sum / Math.max(1, span);
}
