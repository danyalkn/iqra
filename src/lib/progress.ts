/**
 * Personal "where am I in the Quran" math for the Insights page - pure, no
 * React, node-testable.
 *
 * Readers move through the mushaf in order, so their place is the bookmark
 * (last page read) and their progress is that page over time, dropping back
 * to the start after each khatm.
 *
 * Memorizers don't move in order (Juz 30 first, then Juz 2, ...), so their
 * place is the latest sabak, and their progress is how much new sabak has
 * been logged in total, plus which parts of each juz it has covered.
 */

import { localDate, monthKey, MONTH_SHORT } from "@/lib/dates";
import { pageFromRef, totalPages, DEFAULT_MUSHAF, type MushafId } from "@/lib/mushaf";
import { juzLength, rowJuzPage, toQuarter, type PositionedRow } from "@/lib/position";
import type { EntryType } from "@/lib/entries";

/** A local date as a timezone-free timestamp (UTC midnight), so server and
 *  client compute identical chart coordinates. */
export function dayStamp(ymd: string): number {
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
}

export type ProgressRow = PositionedRow & {
  logged_at: string;
  to_ref: string | null;
  pages_equiv: number | null;
  entry_type: EntryType;
  mushaf?: MushafId | null;
};

const byTime = <T extends { logged_at: string }>(a: T, b: T) =>
  new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime();

// ── Reading ────────────────────────────────────────────────────────────────

export type ReadingPoint = { date: string; t: number; page: number };

export type ReadingProgress = {
  /** One point per logged day: the bookmark at the end of that day. */
  trail: ReadingPoint[];
  /** The latest bookmark. */
  page: number;
  mushaf: MushafId;
  total: number;
  /** Times the bookmark wrapped from the end back to the start. */
  khatms: number;
};

/** Bookmark history from reading entries (each stores its last page). */
export function readingProgress(rows: ProgressRow[], tz: string): ReadingProgress | null {
  const reads = rows
    .filter(
      (r) =>
        (r.entry_type === "reading" || r.entry_type === "revising") &&
        pageFromRef(r.to_ref) != null,
    )
    .sort(byTime);
  if (reads.length === 0) return null;

  const trail: ReadingPoint[] = [];
  let khatms = 0;
  let prev: number | null = null;
  for (const r of reads) {
    const page = pageFromRef(r.to_ref)!;
    const total = totalPages(r.mushaf ?? DEFAULT_MUSHAF);
    // A big drop means a finished khatm and a fresh start, not a slip.
    if (prev != null && page < prev && prev - page > total / 2) khatms++;
    prev = page;
    const date = localDate(r.logged_at, tz);
    const last = trail[trail.length - 1];
    if (last && last.date === date) last.page = page;
    else trail.push({ date, t: dayStamp(date), page });
  }
  const latest = reads[reads.length - 1];
  const mushaf = latest.mushaf ?? DEFAULT_MUSHAF;
  return { trail, page: prev!, mushaf, total: totalPages(mushaf), khatms };
}

// ── Memorization ───────────────────────────────────────────────────────────

export type SabakPoint = { date: string; t: number; total: number };

export type JuzCoverage = {
  juz: number;
  length: number;
  /** Quarter-page slots covered by positioned sabak (1 = first quarter of
   *  p.1, 1.75 = its last quarter). */
  quarters: Set<number>;
  /** Pages of sabak logged in this juz without a position. */
  unplaced: number;
  /** Pages covered, capped at the juz length. */
  covered: number;
  lastDate: string;
};

export type HifzProgress = {
  /** Cumulative sabak pages, one point per logged day. */
  trail: SabakPoint[];
  totalPages: number;
  latest: ProgressRow;
  coverage: Map<number, JuzCoverage>;
};

const pagesOf = (r: ProgressRow): number =>
  r.unit === "page" && r.amount != null ? +r.amount : r.pages_equiv ? +r.pages_equiv : 0;

/** New-memorization history from sabak entries. Juz lengths always come
 *  from the user's mushaf: positions are juz-relative, and older hifz rows
 *  only carry the column's default mushaf. */
export function hifzProgress(
  rows: ProgressRow[],
  tz: string,
  mushaf: MushafId,
): HifzProgress | null {
  const sabak = rows.filter((r) => r.entry_type === "sabak" && r.juz != null).sort(byTime);
  if (sabak.length === 0) return null;

  const trail: SabakPoint[] = [];
  const coverage = new Map<number, JuzCoverage>();
  let total = 0;
  for (const r of sabak) {
    const pages = pagesOf(r);
    total += pages;
    const date = localDate(r.logged_at, tz);
    const last = trail[trail.length - 1];
    if (last && last.date === date) last.total = +total.toFixed(2);
    else trail.push({ date, t: dayStamp(date), total: +total.toFixed(2) });

    const juz = r.juz!;
    let c = coverage.get(juz);
    if (!c) {
      const length = juzLength(mushaf, juz);
      c = { juz, length, quarters: new Set(), unplaced: 0, covered: 0, lastDate: date };
      coverage.set(juz, c);
    }
    c.lastDate = date;
    const start = rowJuzPage(r);
    if (start == null) {
      c.unplaced += pages;
    } else {
      // Mark every quarter page the portion covers, inside this juz.
      const end = toQuarter(start + Math.max(pages, 0.25));
      for (let q = toQuarter(start); q < end - 1e-9 && q < c.length + 1; q = toQuarter(q + 0.25)) {
        c.quarters.add(q);
      }
    }
  }
  for (const c of coverage.values()) {
    c.covered = Math.min(c.length, c.quarters.size / 4 + c.unplaced);
  }
  return { trail, totalPages: +total.toFixed(2), latest: sabak[sabak.length - 1], coverage };
}

// ── Months ─────────────────────────────────────────────────────────────────

/** First and last value inside each month, newest month first. */
export function monthSpans<T extends { date: string }>(
  trail: T[],
  value: (p: T) => number,
): { month: string; from: number; to: number; before: number | null }[] {
  const out: { month: string; from: number; to: number; before: number | null }[] = [];
  let before: number | null = null;
  for (const p of trail) {
    const m = monthKey(p.date);
    const last = out[out.length - 1];
    if (last && last.month === m) last.to = value(p);
    else {
      if (last) before = last.to;
      out.push({ month: m, from: value(p), to: value(p), before });
    }
  }
  return out.reverse();
}

/** Month-start stamps between two stamps, for x-axis ticks. At most ~6. */
export function monthTicks(fromT: number, toT: number): number[] {
  const a = new Date(fromT);
  const ticks: number[] = [];
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth() + (a.getUTCDate() > 1 ? 1 : 0);
  for (;;) {
    if (m > 11) {
      y += Math.floor(m / 12);
      m %= 12;
    }
    const t = Date.UTC(y, m, 1);
    if (t > toT) break;
    ticks.push(t);
    m += 1;
  }
  if (ticks.length <= 6) return ticks;
  const step = Math.ceil(ticks.length / 6);
  return ticks.filter((_, i) => i % step === 0);
}

/** X-axis ticks for a date range: month starts when the range spans at
 *  least two of them, otherwise the first, middle and last day. */
export function timeTicks(
  fromT: number,
  toT: number,
): { ticks: number[]; format: (t: number) => string } {
  const months = monthTicks(fromT, toT);
  if (months.length >= 2) return { ticks: months, format: monthShort };
  const day = 86_400_000;
  const span = Math.round((toT - fromT) / day);
  const ticks =
    span <= 1
      ? [fromT]
      : span < 14
        ? [fromT, toT]
        : [fromT, fromT + Math.round(span / 2) * day, toT];
  return {
    ticks,
    format: (t) => {
      const d = new Date(t);
      return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
    },
  };
}

/** "Sep" for a month-start stamp (UTC, so it never drifts a month). */
export function monthShort(t: number): string {
  return MONTH_SHORT[new Date(t).getUTCMonth()];
}
