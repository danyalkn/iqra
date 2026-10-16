/** Personal insight + advice engine for the Insights page (mine scope).
 *
 * Three rules drive everything here:
 *  1. Every line is about YOUR relationship with the Quran - never a
 *     comparison with another member (owner direction, 2026-08-29).
 *  2. Phrasing rotates weekly and per-person, from pools, so the card never
 *     reads like the same form letter twice. Selection is deterministic on
 *     (week, user, kind): stable within a week - no flicker between renders,
 *     no server/client hydration mismatch - different the next week.
 *  3. A week is judged against a TYPICAL week, never against last week on
 *     its own: see weekBaseline (owner direction, 2026-10-11).
 *
 * Pure module: no React, no I/O. `**bold**` markers are rendered by the UI.
 */

import { localDate, weekDates, weekDatesUpTo, addWeeks, startOfWeek } from "@/lib/dates";
import {
  juzForPage,
  juzStartPages,
  surahForPage,
  totalPages,
  pageFromRef,
  DEFAULT_MUSHAF,
  type MushafId,
} from "@/lib/mushaf";

export type InsightKind =
  | "trend"
  | "outlierWeek"
  | "streak"
  | "consistency"
  | "nextJuz"
  | "weekday"
  | "timeOfDay"
  | "bestWeek"
  | "month"
  | "eta";

export type Insight = { kind: InsightKind; text: string; delta?: number | null };

/** Minimal entry shape the engine needs (subset of LogRow / ReadingRow). */
export type InsightEntry = {
  logged_at: string;
  pages_equiv: number | null;
  entry_type?: string;
  to_ref?: string | null;
  mushaf?: string | null;
};

const round1 = (n: number) => +n.toFixed(1);

/** djb2 - tiny, deterministic, identical on server and client. */
export function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

const pick = <T,>(pool: T[], seed: string): T => pool[hashSeed(seed) % pool.length];

/** Fill `{key}` slots in a template. */
function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ── Weekly baseline ─────────────────────────────────────────────────────────

/** Pages per local date. One timezone conversion per row, after which every
 *  week total below is map lookups. */
export function pagesByDay(rows: InsightEntry[], tz: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of rows) {
    const p = e.pages_equiv ? +e.pages_equiv : 0;
    if (!p) continue;
    const d = localDate(e.logged_at, tz);
    out.set(d, (out.get(d) ?? 0) + p);
  }
  return out;
}

const sumDays = (byDay: Map<string, number>, days: string[]) =>
  days.reduce((s, d) => s + (byDay.get(d) ?? 0), 0);

/** Mean of the middle: the highest and lowest samples are dropped before
 *  averaging, so one blow-out week - or one dead week - can't set the bar.
 *  Under four samples there is nothing safe to trim. */
function trimmedMean(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const cut = Math.floor(s.length / 4);
  const core = s.slice(cut, s.length - cut);
  return core.reduce((a, b) => a + b, 0) / core.length;
}

export type WeekBaseline = {
  /** Typical pages by this point in a week (Mon → day `spanDays`). */
  typicalSpan: number;
  /** Typical pages across a whole week. */
  typicalWeek: number;
  /** Whole weeks behind those averages; under 3 they aren't worth trusting. */
  weeks: number;
  /** Last whole week, and whether it sat far off this person's normal. */
  lastWeek: { pages: number; outlier: "high" | "low" | null } | null;
};

/**
 * What a normal week looks like here, from the last `lookback` whole weeks.
 *
 * Week-over-week on its own lies. The circle sprints in the last week of the
 * month to climb the leaderboard, so the first week of the next month reads
 * as a collapse against a week that was never anyone's baseline - "100% down"
 * when their actual pace never changed. Judging the week against a trimmed
 * average, with month-end spikes and dead weeks dropped, is the comparison
 * people actually mean (owner direction, 2026-10-11).
 */
export function weekBaseline(
  byDay: Map<string, number>,
  today: string,
  spanDays: number,
  lookback = 12,
): WeekBaseline {
  // Weeks before the first logged day aren't quiet weeks - they're weeks this
  // person wasn't here for, and they'd drag every average toward zero.
  let firstDay = "";
  for (const [d, p] of byDay) {
    if (p > 0 && (firstDay === "" || d < firstDay)) firstDay = d;
  }

  const weekTotals: number[] = [];
  const spanTotals: number[] = [];
  for (let w = 1; w <= lookback; w++) {
    const days = weekDates(addWeeks(today, -w));
    if (firstDay === "" || days[6] < firstDay) continue;
    weekTotals.push(sumDays(byDay, days));
    spanTotals.push(sumDays(byDay, days.slice(0, spanDays)));
  }

  const typicalWeek = round1(trimmedMean(weekTotals));
  // w = 1 came first, so index 0 is last week (absent for a brand-new member).
  const last = weekTotals.length > 0 ? weekTotals[0] : null;
  return {
    typicalSpan: round1(trimmedMean(spanTotals)),
    typicalWeek,
    weeks: weekTotals.length,
    lastWeek:
      last == null
        ? null
        : {
            pages: round1(last),
            // Needs both a ratio and an absolute gap: 4 pages against a
            // typical 2 is noise, not a surge.
            outlier:
              weekTotals.length < 4 ||
              typicalWeek === 0 ||
              Math.abs(last - typicalWeek) < 8
                ? null
                : last >= typicalWeek * 1.4
                  ? "high"
                  : last <= typicalWeek * 0.6
                    ? "low"
                    : null,
          },
  };
}

// ── Signals ─────────────────────────────────────────────────────────────────

export type PersonalSignals = {
  pagesThisWeek: number;
  pagesSameSpanLastWeek: number;
  spanDays: number;
  /** What a normal week looks like for this person - the yardstick the week
   *  trend is judged against, in place of whatever last week happened to be. */
  baseline: WeekBaseline;
  activeOf14: number;
  streak: number;
  longestStreak: number;
  /** Strongest weekday all-time, only when the pattern is real (≥15 pages, ≥25% share). */
  topWeekday: { day: number; pages: number; share: number } | null;
  /** Where in the day entries happen, when one bucket clearly leads. */
  topTime: { label: string; share: number } | null;
  /** Best completed calendar week ever (excludes the current, open week). */
  bestWeek: { pages: number; weekStart: string } | null;
  bookmark: { page: number; surah: string; left: number } | null;
  nextJuz: { juz: number; pagesLeft: number } | null;
  /** Khatmah finish estimate from 14-day pace, reading/revising pages only. */
  etaDays: number | null;
};

export function computeSignals(opts: {
  mine: InsightEntry[]; // recent window (~180d), newest first
  mineAllTime: InsightEntry[]; // slim all-time rows
  mineDays: Set<string>; // all local dates with ≥1 entry (recent window)
  streak: number;
  longestStreak: number;
  tz: string;
  today: string;
}): PersonalSignals {
  const { mine, mineAllTime, mineDays, streak, longestStreak, tz, today } = opts;

  const thisWeek = weekDatesUpTo(today, today);
  const spanDays = thisWeek.length;
  const byDay = pagesByDay(mine, tz);
  const pagesThisWeek = round1(sumDays(byDay, thisWeek));
  const pagesSameSpanLastWeek = round1(
    sumDays(byDay, weekDates(addWeeks(today, -1)).slice(0, spanDays)),
  );
  const baseline = weekBaseline(byDay, today, spanDays);

  // Last-14 consistency from the recent window.
  let activeOf14 = 0;
  {
    let d = today;
    for (let i = 0; i < 14; i++) {
      if (mineDays.has(d)) activeOf14++;
      const t = new Date(`${d}T12:00:00`);
      t.setDate(t.getDate() - 1);
      d = t.toLocaleDateString("en-CA");
    }
  }

  // Weekday pattern, all-time.
  let topWeekday: PersonalSignals["topWeekday"] = null;
  {
    const byDow = new Array(7).fill(0);
    let total = 0;
    for (const e of mineAllTime) {
      const p = e.pages_equiv ? +e.pages_equiv : 0;
      if (!p) continue;
      byDow[new Date(`${localDate(e.logged_at, tz)}T12:00:00`).getDay()] += p;
      total += p;
    }
    if (total >= 15) {
      const day = byDow.indexOf(Math.max(...byDow));
      const share = byDow[day] / total;
      if (share >= 0.25) topWeekday = { day, pages: round1(byDow[day]), share };
    }
  }

  // Time-of-day pattern (entry timestamps, local hour).
  let topTime: PersonalSignals["topTime"] = null;
  if (mine.length >= 10) {
    const buckets: Record<string, number> = {
      "around Fajr": 0,
      "during the day": 0,
      "in the evening": 0,
      "late at night": 0,
    };
    for (const e of mine) {
      const h = +new Date(e.logged_at).toLocaleString("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
      });
      if (h >= 3 && h < 9) buckets["around Fajr"]++;
      else if (h >= 9 && h < 17) buckets["during the day"]++;
      else if (h >= 17 && h < 22) buckets["in the evening"]++;
      else buckets["late at night"]++;
    }
    const [label, n] = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
    const share = n / mine.length;
    if (share >= 0.5) topTime = { label, share };
  }

  // Best completed week ever (open week excluded - it can still grow).
  let bestWeek: PersonalSignals["bestWeek"] = null;
  {
    const currentMonday = startOfWeek(today);
    const byWeek = new Map<string, number>();
    for (const e of mineAllTime) {
      const p = e.pages_equiv ? +e.pages_equiv : 0;
      if (!p) continue;
      const wk = startOfWeek(localDate(e.logged_at, tz));
      if (wk === currentMonday) continue;
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + p);
    }
    for (const [weekStart, pages] of byWeek) {
      if (!bestWeek || pages > bestWeek.pages) bestWeek = { pages: round1(pages), weekStart };
    }
  }

  // Bookmark, next-juz distance, khatmah ETA.
  let bookmark: PersonalSignals["bookmark"] = null;
  let nextJuz: PersonalSignals["nextJuz"] = null;
  let etaDays: number | null = null;
  {
    const lastRead = mine.find(
      (e) => (e.entry_type === "reading" || e.entry_type === "revising") && e.to_ref,
    );
    const page = pageFromRef(lastRead?.to_ref);
    if (lastRead && page) {
      const m = (lastRead.mushaf ?? DEFAULT_MUSHAF) as MushafId;
      const total = totalPages(m);
      bookmark = { page, surah: surahForPage(m, page).name, left: total - page };

      const juz = juzForPage(m, page);
      const starts = juzStartPages(m);
      if (juz < 30) {
        // starts[juz] = first page of juz+1 (0-indexed array). The bookmark
        // is the last page READ, so it doesn't count toward what's left -
        // on the final page of a juz there are 0 pages left, not 1.
        const pagesLeft = starts[juz] - page - 1;
        if (pagesLeft > 0) nextJuz = { juz, pagesLeft };
      }

      const cutoff = new Date(`${today}T12:00:00`);
      cutoff.setDate(cutoff.getDate() - 13);
      const floor = cutoff.toLocaleDateString("en-CA");
      const pacePages = round1(
        mine.reduce((s, e) => {
          if (e.entry_type !== "reading" && e.entry_type !== "revising") return s;
          const d = localDate(e.logged_at, tz);
          return d >= floor && d <= today ? s + (e.pages_equiv ? +e.pages_equiv : 0) : s;
        }, 0),
      );
      const pace = pacePages / 14;
      if (pace > 0 && bookmark.left > 0) etaDays = Math.ceil(bookmark.left / pace);
    }
  }

  return {
    pagesThisWeek,
    pagesSameSpanLastWeek,
    spanDays,
    baseline,
    activeOf14,
    streak,
    longestStreak,
    topWeekday,
    topTime,
    bestWeek,
    bookmark,
    nextJuz,
    etaDays,
  };
}

// ── Lines ───────────────────────────────────────────────────────────────────

type Candidate = { kind: InsightKind; text: string; delta?: number | null; weight: number };

/** Build the personal insight list: 4 varied lines + rotation across weeks. */
export function buildPersonalInsights(
  s: PersonalSignals,
  opts: { seedBase: string; includeEta: boolean },
): Insight[] {
  const { seedBase, includeEta } = opts;
  const seed = (kind: string) => seedBase + ":" + kind;
  const out: Candidate[] = [];

  // 1 · Week trend - always present, leads the card. The yardstick is a
  // typical week for this person, not last week: see weekBaseline.
  {
    const { pagesThisWeek: p, pagesSameSpanLastWeek: q, spanDays, baseline } = s;
    const usual =
      baseline.weeks >= 3 && baseline.typicalSpan > 0 ? baseline.typicalSpan : null;
    // A burst reader - weekends only, say - can have months of history and
    // still nothing at all in the first days of a week, leaving no span
    // baseline to compare against. Judging them against last week's same days
    // would walk straight back into the bug this baseline exists to kill, so
    // fall back to the shape of a whole week instead, and without a badge:
    // part of a week against all of one isn't a like-for-like number.
    const usualWeek =
      usual == null && baseline.weeks >= 3 && baseline.typicalWeek > 0
        ? baseline.typicalWeek
        : null;
    const v = {
      p,
      q,
      t: usual ?? 0,
      w: usualWeek ?? 0,
      d: spanDays,
      pw: p === 1 ? "page" : "pages",
      dw: spanDays === 1 ? "day" : "days",
    };
    let text: string;
    let delta: number | null;

    if (usual != null && p === 0) {
      // No badge on an empty week: "-100%" against a normal week is a true
      // number that tells you nothing you can act on.
      delta = null;
      text = fill(
        pick(
          [
            "Nothing logged yet this week. A normal week has you at {t} by now; one page restarts it.",
            "A quiet week so far. Your usual by this point is {t} pages - tonight is enough to begin.",
          ],
          seed("paceZero"),
        ),
        v,
      );
    } else if (usual != null) {
      // Within a sixth of normal is the same week, told twice.
      const ratio = (p - usual) / usual;
      delta = ratio;
      text = fill(
        pick(
          ratio > 0.15
            ? [
                "**{p} {pw}** so far this week, ahead of the {t} a normal week has by now.",
                "You're at **{p} {pw}**, past your usual {t} for {d} {dw} in.",
                "**{p} {pw}** in {d} {dw}: a strong week by your own standards, where {t} is typical.",
              ]
            : ratio < -0.15
              ? [
                  "**{p} {pw}** so far; a normal week has you at {t} by this point. Plenty of week left.",
                  "This week: **{p} {pw}**. Your usual by now is {t}, and the rest of the week is still open.",
                  "You're at **{p}** against your typical {t} for {d} {dw} in. A single page starts the catch-up.",
                ]
              : [
                  "**{p} {pw}** so far, right about your usual pace for {d} {dw} in.",
                  "**{p} {pw}** this week, in line with the {t} a normal week has by now.",
                  "Steady: **{p} {pw}**, the shape of an ordinary week for you ({t} by this point).",
                ],
          seed(ratio > 0.15 ? "paceAhead" : ratio < -0.15 ? "paceBehind" : "paceOn"),
        ),
        v,
      );
    } else if (usualWeek != null) {
      delta = null;
      text = fill(
        pick(
          p === 0
            ? [
                "Nothing logged yet this week. A normal week for you comes to about {w} pages - one page starts it.",
                "A quiet start. Your weeks usually land near {w} pages, and there's still room for this one to.",
              ]
            : [
                "**{p} {pw}** so far this week. A normal week for you lands around {w}.",
                "You're at **{p} {pw}**, {d} {dw} in; your weeks usually come to about {w}.",
              ],
          seed("paceWeek"),
        ),
        v,
      );
    } else {
      // Too new for any baseline - last week is all there is to go on, and
      // nobody has had time to build a month-end spike yet.
      delta = p > 0 && q > 0 ? (p - q) / q : null;
      if (p === 0 && q === 0) {
        text = pick(
          [
            "A quiet stretch: nothing logged this week or last. The next page ends it.",
            "Two quiet weeks side by side. One entry tonight changes the shape of this card.",
          ],
          seed("trend0"),
        );
      } else if (p >= q) {
        text = fill(
          pick(
            [
              "**{p} {pw}** so far this week. By this point last week you had {q}.",
              "You're at **{p} {pw}** this week, ahead of last week's {q} at the same point.",
              "**{p} {pw}** down, {d} {dw} in. Last week's pace would be {q}.",
            ],
            seed("trendUp"),
          ),
          v,
        );
      } else {
        text = fill(
          pick(
            [
              "**{p} {pw}** this week so far; last week you'd reached {q} by now. Plenty of week left.",
              "This week: **{p} {pw}**. Same days last week: {q}. The gap is one sitting.",
              "You're at **{p}** against last week's {q} at this point. A single page starts the catch-up.",
            ],
            seed("trendDown"),
          ),
          v,
        );
      }
    }
    out.push({ kind: "trend", text, delta, weight: 100 });
  }

  // 1b · Defuse an unusual week before it becomes the yardstick. Without
  // this, the week after a month-end push reads as a collapse and people take
  // the drop at face value - the surge was never their baseline.
  if (s.baseline.lastWeek?.outlier && s.baseline.typicalWeek > 0) {
    const lw = s.baseline.lastWeek;
    if (lw.outlier === "high" && s.pagesThisWeek < lw.pages) {
      out.push({
        kind: "outlierWeek",
        weight: 85,
        text: fill(
          pick(
            [
              "Last week's **{lw} pages** was a surge, not your baseline: a normal week for you is nearer {t}. That's what this week is measured against.",
              "Don't read this week against last week. **{lw} pages** sat well above your usual {t}, so a smaller number now isn't a slide.",
            ],
            seed("outlierHigh"),
          ),
          { lw: lw.pages, t: s.baseline.typicalWeek },
        ),
      });
    } else if (lw.outlier === "low" && s.pagesThisWeek > lw.pages) {
      out.push({
        kind: "outlierWeek",
        weight: 65,
        text: fill(
          pick(
            [
              "Last week dipped to **{lw} pages**, under your usual {t}. You're already past it this week: a return to normal, not a leap.",
              "**{lw} pages** last week was the low one, not the measure. Your usual is about {t}, and this week is already ahead of last.",
            ],
            seed("outlierLow"),
          ),
          { lw: lw.pages, t: s.baseline.typicalWeek },
        ),
      });
    }
  }

  // 2 · Streak.
  if (s.streak >= s.longestStreak && s.streak >= 3) {
    out.push({
      kind: "streak",
      weight: 90,
      text: fill(
        pick(
          [
            "**{s} days running, your longest streak ever.** Every day now sets a new record.",
            "This is uncharted: **{s} straight days**, the longest you've ever gone.",
          ],
          seed("streakRecord"),
        ),
        { s: s.streak },
      ),
    });
  } else if (s.streak >= 2) {
    out.push({
      kind: "streak",
      weight: 70,
      text: fill(
        pick(
          [
            "**{s} days** in a row. Your record is {L}, and it's catchable.",
            "Streak at **{s}**. The one to beat: {L} days.",
            "**{s} straight days.** {left} more matches your best run.",
          ],
          seed("streak"),
        ),
        { s: s.streak, L: s.longestStreak, left: Math.max(1, s.longestStreak - s.streak) },
      ),
    });
  } else if (s.longestStreak >= 3) {
    out.push({
      kind: "streak",
      weight: 40,
      text: fill(
        pick(
          [
            "Your longest run is **{L} days**. Day one of the next one is available tonight.",
            "You've done **{L} days in a row** before. That version of you is still in there.",
          ],
          seed("streakGone"),
        ),
        { L: s.longestStreak },
      ),
    });
  }

  // 3 · Next juz within reach.
  if (s.nextJuz && s.nextJuz.pagesLeft <= 15) {
    out.push({
      kind: "nextJuz",
      weight: 80,
      text: fill(
        pick(
          [
            "**{n} page{pl}** left in Juz {j}. Close enough to finish this week.",
            "Juz {j} is **{n} page{pl}** from done.",
            "You're **{n} page{pl}** from closing out Juz {j}.",
          ],
          seed("nextJuz"),
        ),
        { n: s.nextJuz.pagesLeft, j: s.nextJuz.juz, pl: s.nextJuz.pagesLeft === 1 ? "" : "s" },
      ),
    });
  }

  // 4 · Best week - celebrate a record in progress, or dangle a close one.
  if (s.bestWeek) {
    if (s.pagesThisWeek > s.bestWeek.pages) {
      out.push({
        kind: "bestWeek",
        weight: 95,
        text: fill(
          pick(
            [
              "**Your best week ever, in progress.** {p} pages; the old record was {b}.",
              "Record broken: **{p} pages** this week, past your previous best of {b}.",
            ],
            seed("bestNow"),
          ),
          { p: s.pagesThisWeek, b: s.bestWeek.pages },
        ),
      });
    } else if (s.bestWeek.pages - s.pagesThisWeek <= 5 && s.pagesThisWeek > 0) {
      out.push({
        kind: "bestWeek",
        weight: 75,
        text: fill(
          pick(
            [
              "Your record week is **{b} pages**. You're {gap} away from it right now.",
              "**{gap} page{pl}** between you and your best week ever ({b}).",
            ],
            seed("bestNear"),
          ),
          (() => {
            const gap = round1(s.bestWeek.pages - s.pagesThisWeek);
            return { b: s.bestWeek.pages, gap, pl: gap === 1 ? "" : "s" };
          })(),
        ),
      });
    } else {
      out.push({
        kind: "bestWeek",
        weight: 30,
        text: fill(
          pick(
            [
              "Your best week so far: **{b} pages**. A target, not a ceiling.",
              "The week to beat: **{b} pages**, your all-time best.",
            ],
            seed("best"),
          ),
          { b: s.bestWeek.pages },
        ),
      });
    }
  }

  // 5 · Weekday pattern.
  if (s.topWeekday) {
    out.push({
      kind: "weekday",
      weight: 50,
      text: fill(
        pick(
          [
            "**{day}s** carry your reading: {pages} pages all-time, more than any other day.",
            "No day works for you like **{day}** ({pages} pages so far).",
            "Your strongest day is **{day}**, with {pct}% of everything you've read.",
          ],
          seed("weekday"),
        ),
        {
          day: WEEKDAY_NAMES[s.topWeekday.day],
          pages: s.topWeekday.pages,
          pct: Math.round(s.topWeekday.share * 100),
        },
      ),
    });
  }

  // 6 · Time-of-day pattern.
  if (s.topTime) {
    out.push({
      kind: "timeOfDay",
      weight: 45,
      text: fill(
        pick(
          [
            "Most of your reading happens **{label}**: {pct}% of your entries.",
            "{pct}% of your entries land **{label}** - that's your window.",
          ],
          seed("timeOfDay"),
        ),
        { label: s.topTime.label, pct: Math.round(s.topTime.share * 100) },
      ),
    });
  }

  // 7 · Consistency.
  {
    const n = s.activeOf14;
    const phrase =
      n >= 11
        ? pick(["rock steady", "a real rhythm now", "the habit is holding you"], seed("cph1"))
        : n >= 7
          ? pick(
              ["a rhythm is forming", "more days on than off", "the shape of a habit"],
              seed("cph2"),
            )
          : n >= 4
            ? pick(["finding your feet", "building back", "a base to grow from"], seed("cph3"))
            : pick(["a fresh start is waiting", "room to begin again"], seed("cph4"));
    out.push({
      kind: "consistency",
      weight: 60,
      text: fill(
        pick(
          [
            "Logged on **{n} of the last 14** days: {phrase}.",
            "**{n} of 14** recent days have an entry: {phrase}.",
          ],
          seed("consistency"),
        ),
        { n, phrase },
      ),
    });
  }

  // 8 · Khatmah ETA (hifz mode only - reading mode has the khatmah card).
  if (includeEta && s.etaDays && s.bookmark) {
    out.push({
      kind: "eta",
      weight: 55,
      text: fill(
        pick(
          [
            "On page **{p}** ({surah}), about **{d} day{dpl}** to the khatmah at your current pace.",
            "At this pace the khatmah lands in about **{d} day{dpl}**. You're on p.{p}, {surah}.",
          ],
          seed("eta"),
        ),
        {
          p: s.bookmark.page,
          surah: s.bookmark.surah,
          d: s.etaDays,
          dpl: s.etaDays === 1 ? "" : "s",
        },
      ),
    });
  }

  // Selection: trend always leads; then the highest-weight lines, with a
  // weekly-rotating tiebreak so mid-weight lines take turns appearing.
  const [lead, ...rest] = [
    out.find((c) => c.kind === "trend")!,
    ...out.filter((c) => c.kind !== "trend"),
  ];
  const jitter = (c: Candidate) => c.weight + (hashSeed(seed("rot:" + c.kind)) % 25);
  rest.sort((a, b) => jitter(b) - jitter(a));
  return [lead, ...rest.slice(0, 3)].map(({ kind, text, delta }) => ({ kind, text, delta }));
}

// ── Advice ──────────────────────────────────────────────────────────────────

/** One practical, personal suggestion - rotates weekly, reacts to patterns. */
export function buildAdvice(s: PersonalSignals, seedBase: string): string {
  const seed = seedBase + ":advice";

  if (s.streak === 0 && s.activeOf14 <= 3) {
    return pick(
      [
        "Start smaller than feels worthwhile: half a page after one salah you never miss. Consistency first, volume later.",
        "Restart with one ayah after Maghrib tonight. The point isn't the amount; it's ending the silence.",
        "Pick your easiest salah and staple one page to it. A tiny anchor beats a big plan.",
      ],
      seed,
    );
  }
  if (s.baseline.lastWeek?.outlier === "high" && s.pagesThisWeek < s.baseline.typicalSpan) {
    return pick(
      [
        "A sprint week feels great and then charges you a quiet one. Pick the pace you could hold on an ordinary Tuesday and let the totals follow.",
        "Big weeks are worth having, but the number that finishes a khatmah is the one you can repeat. Set your floor, not your record.",
      ],
      seed,
    );
  }
  if (s.topTime?.label === "late at night" && s.activeOf14 < 11) {
    return pick(
      [
        "Your reading lives late at night, the first slot to vanish on a tired day. Try moving one page to right after Maghrib and see if the missed days shrink.",
        "Late-night reading is fragile reading. Anchor a page to a salah earlier in the day and the streak stops depending on how sleepy you are.",
      ],
      seed,
    );
  }
  if (s.topWeekday && (s.topWeekday.day === 0 || s.topWeekday.day === 6) && s.activeOf14 < 10) {
    return pick(
      [
        "Most of your pages come on weekends. One small weekday anchor, even half a page after work, would smooth the whole week out.",
        "You read in weekend bursts. Try borrowing just one of those pages for a Tuesday; rhythm beats volume.",
      ],
      seed,
    );
  }
  if (s.streak >= 3) {
    return pick(
      [
        "Streaks die on busy days, not lazy ones. Decide now what your minimum is on a chaotic day; one ayah with attention counts.",
        "Protect the streak with a floor, not a goal: on the worst day, one ayah before bed keeps the thread alive.",
      ],
      seed,
    );
  }
  return pick(
    [
      "Five ayahs after every salah quietly adds up to a khatmah a year.",
      "Keep your mushaf somewhere it can look at you: out of the drawer, onto the desk.",
      "Read along while a reciter plays; it carries you further than pushing through alone.",
      "Tie your reading to a salah you never miss; habits hold better on existing hooks.",
    ],
    seed,
  );
}
