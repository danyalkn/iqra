"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Users,
  BookMarked,
  Hourglass,
  Flag,
  CalendarCheck,
  CalendarDays,
  Clock3,
  Flame,
  Lightbulb,
  ChevronLeft,
  ChevronRight,
  Info,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";
import { type Mode } from "@/lib/entries";
import { pageFromRef, surahForPage, type MushafId } from "@/lib/mushaf";
import { KHATMAH_PAGES } from "@/lib/khatmah";
import type { GroupMember, LogRow, ReadingRow } from "@/lib/types";
import {
  localDate,
  todayLocal,
  currentStreak,
  longestStreak,
  shortDate,
  dayLabel,
  weekDates,
  weekDatesUpTo,
  addWeeks,
  startOfWeek,
  weekRangeLabel,
  monthKey,
  addMonths,
  monthDates,
  monthLabel,
} from "@/lib/dates";
import { cn } from "@/lib/cn";
import {
  computeSignals,
  buildPersonalInsights,
  buildAdvice,
  pagesByDay,
  weekBaseline,
  type InsightKind,
} from "@/lib/insights";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { TooltipCard, useChartColors } from "./chartKit";
import { KhatmahCard } from "./KhatmahCard";
import { ProgressCard } from "./ProgressCard";
import { HifzBreakdownCard } from "./HifzBreakdownCard";

type Scope = "mine" | "group";
type Filter = "all" | "sabak" | "sabak_para" | "dor";

// Monday-first, matching the Mon–Sun heatmap rows.
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

// Icon per personal-insight kind (trend swaps up/down at the call site).
const INSIGHT_ICONS: Record<InsightKind, LucideIcon> = {
  trend: TrendingUp,
  outlierWeek: Activity,
  streak: Flame,
  consistency: CalendarCheck,
  nextJuz: BookMarked,
  weekday: CalendarDays,
  timeOfDay: Clock3,
  bestWeek: Trophy,
  month: CalendarDays,
  eta: Flag,
};

/** Render the engine's `**bold**` markers as real emphasis. */
function emphasize(text: string): React.ReactNode {
  const parts = text.split("**");
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} className="font-semibold">
        {part}
      </b>
    ) : (
      part
    ),
  );
}

const pagesOf = (rows: { pages_equiv: number | null }[]) =>
  +rows.reduce((s, e) => s + (e.pages_equiv ? +e.pages_equiv : 0), 0).toFixed(1);

export function StatsClient({
  mode,
  tz,
  userId,
  members,
  entries,
  readingAll,
  mine,
  mushaf,
  initialScope = "mine",
}: {
  mode: Mode;
  tz: string;
  userId: string;
  members: GroupMember[];
  entries: LogRow[];
  readingAll: ReadingRow[];
  /** The signed-in user's own entries, all time (progress + hifz cards). */
  mine: LogRow[];
  mushaf: MushafId;
  initialScope?: Scope;
}) {
  const reading = mode === "reading";
  const memberCount = members.length;
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<Scope>(initialScope);
  const [showCoverage, setShowCoverage] = useState(false);
  const colors = useChartColors();

  const today = todayLocal(tz);

  const scoped = useMemo(
    () =>
      scope === "mine" ? entries.filter((e) => e.user_id === userId) : entries,
    [entries, scope, userId],
  );
  // Readers have one category. Memorizers filter by All / Sabak / Sabak Para /
  // Dhor - reading entries only appear under All.
  const chartEntries = useMemo(() => {
    // The type filter only exists in personal hifz view; never let a stale
    // value silently filter the group heatmap.
    if (reading || scope === "group" || filter === "all") return scoped;
    return scoped.filter((e) => e.entry_type === filter);
  }, [scoped, filter, reading, scope]);

  // Streak from the user's own entries.
  const mineDays = useMemo(
    () =>
      new Set(
        entries
          .filter((e) => e.user_id === userId)
          .map((e) => localDate(e.logged_at, tz)),
      ),
    [entries, userId, tz],
  );
  const streak = currentStreak(mineDays, tz);
  const longest = longestStreak(mineDays);

  // Heatmap: entries per day over the last 5 calendar weeks (Mon–Sun rows),
  // ending with the current, partly-finished week. Whole weeks rather than a
  // rolling 35 days, so the columns line up with real weekdays.
  const heatGrid = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of chartEntries) {
      const d = localDate(e.logged_at, tz);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    // Pick the rendered days first, then scale intensity to the busiest of
    // *those*. Scaling against every day in the 180-day entries window would
    // let one heavy day months ago (Ramadan, say) flatten the visible weeks
    // into a uniform wash.
    const days: (string | null)[] = [];
    for (let w = 4; w >= 0; w--) {
      for (const d of weekDates(addWeeks(today, -w))) {
        // Days after today in the current week stay blank.
        days.push(d > today ? null : d);
      }
    }
    const max = Math.max(
      1,
      ...days.map((d) => (d === null ? 0 : (byDay.get(d) ?? 0))),
    );
    return days.map((d) => {
      if (d === null) return null;
      const c = byDay.get(d) ?? 0;
      return { date: d, count: c, op: c === 0 ? 0 : 0.3 + 0.7 * (c / max) };
    });
  }, [chartEntries, tz, today]);
  const [activeCell, setActiveCell] = useState<number | null>(null);

  // Weekly trend: real calendar weeks (Mon–Sun), last 8 including this one.
  // The current week is partial by design - it runs Monday → today.
  const weeklyBar = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of chartEntries) {
      const d = localDate(e.logged_at, tz);
      byDay.set(d, (byDay.get(d) ?? 0) + (e.pages_equiv ? +e.pages_equiv : 0));
    }
    const out: { label: string; full: string; pages: number }[] = [];
    for (let w = 7; w >= 0; w--) {
      const monday = addWeeks(today, -w);
      const dates = weekDatesUpTo(monday, today);
      const pages = +dates
        .reduce((s, d) => s + (byDay.get(d) ?? 0), 0)
        .toFixed(1);
      const range = weekRangeLabel(monday, dates[dates.length - 1]);
      out.push({
        label: shortDate(monday),
        // Say so when the last bar is a week still in progress.
        full: dates.length < 7 ? `${range} · so far` : range,
        pages,
      });
    }
    return out;
  }, [chartEntries, tz, today]);
  const weeklyTotal = +weeklyBar.reduce((s, w) => s + w.pages, 0).toFixed(1);

  // This calendar week so far: Monday → today.
  const thisWeekDates = useMemo(() => weekDatesUpTo(today, today), [today]);

  const loggedTodayCount = useMemo(
    () =>
      new Set(
        entries
          .filter((e) => localDate(e.logged_at, tz) === today)
          .map((e) => e.user_id),
      ).size,
    [entries, tz, today],
  );
  const weekCount = useMemo(() => {
    const days = new Set(thisWeekDates);
    return scoped.filter((e) => days.has(localDate(e.logged_at, tz))).length;
  }, [scoped, tz, thisWeekDates]);

  const totalEntries = chartEntries.length;
  const noteCount = useMemo(() => mine.filter((e) => e.notes).length, [mine]);

  // ── Group khatmah (all-time, every entry type) ──────────────────────────
  // pages_equiv already converts juz/quarter/hizb → pages; page amounts are
  // raw pages; ayah-only entries contribute nothing.
  const groupRead = pagesOf(readingAll);
  const khatmahs = Math.floor(groupRead / KHATMAH_PAGES);
  const khatmahProgress = +(groupRead - khatmahs * KHATMAH_PAGES).toFixed(1);

  // ── Month browsing ────────────────────────────────────────────────────────
  // readingAll carries every page-bearing entry ever (no date window), so any
  // past month can be shown from data already on the client.
  const thisMonth = monthKey(today);
  const [month, setMonth] = useState(thisMonth);
  const isThisMonth = month === thisMonth;

  /** Local month key of each row, computed once - the timezone conversion is
   *  the expensive part and every month view needs it. */
  const readingByMonth = useMemo(() => {
    const out = new Map<string, { user_id: string; date: string; pages: number }[]>();
    let earliest = thisMonth;
    for (const r of readingAll) {
      const pages = r.pages_equiv ? +r.pages_equiv : 0;
      if (!pages) continue;
      const date = localDate(r.logged_at, tz);
      const key = monthKey(date);
      if (key < earliest) earliest = key;
      const bucket = out.get(key);
      if (bucket) bucket.push({ user_id: r.user_id, date, pages });
      else out.set(key, [{ user_id: r.user_id, date, pages }]);
    }
    return { byMonth: out, earliest };
  }, [readingAll, tz, thisMonth]);

  // Don't let the user page back past the first month with any data.
  const canGoBack = month > readingByMonth.earliest;

  // ── All-time & selected-month totals (true all-time: readingAll has no date
  // window, unlike `entries` which is capped at 180 days) ───────────────────
  const totals = useMemo(() => {
    const rowsFor = (key: string) => readingByMonth.byMonth.get(key) ?? [];
    const sumBy = (key: string) => {
      const per = new Map<string, number>();
      let total = 0;
      for (const r of rowsFor(key)) {
        per.set(r.user_id, (per.get(r.user_id) ?? 0) + r.pages);
        total += r.pages;
      }
      return { per, total };
    };

    const selected = sumBy(month);
    const previous = sumBy(addMonths(month, -1));

    const allTime = new Map<string, number>();
    for (const rows of readingByMonth.byMonth.values()) {
      for (const r of rows) {
        allTime.set(r.user_id, (allTime.get(r.user_id) ?? 0) + r.pages);
      }
    }

    const board = members
      .map((m) => ({
        member: m,
        all: +(allTime.get(m.user_id) ?? 0).toFixed(1),
        month: +(selected.per.get(m.user_id) ?? 0).toFixed(1),
      }))
      .sort((a, b) => b.month - a.month || b.all - a.all);

    return {
      board,
      maxMonth: Math.max(1, ...board.map((b) => b.month)),
      myAll: +(allTime.get(userId) ?? 0).toFixed(1),
      myMonth: +(selected.per.get(userId) ?? 0).toFixed(1),
      myPrevMonth: +(previous.per.get(userId) ?? 0).toFixed(1),
      groupMonth: +selected.total.toFixed(1),
      groupPrevMonth: +previous.total.toFixed(1),
    };
  }, [readingByMonth, members, userId, month]);

  // Pages per day across the selected month (capped at today for this month).
  const monthBar = useMemo(() => {
    const rows = readingByMonth.byMonth.get(month) ?? [];
    const mine = scope === "mine";
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (mine && r.user_id !== userId) continue;
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.pages);
    }
    return monthDates(month, isThisMonth ? today : undefined).map((d) => ({
      label: String(+d.slice(8, 10)),
      full: shortDate(d),
      pages: +(byDay.get(d) ?? 0).toFixed(1),
    }));
  }, [readingByMonth, month, scope, userId, isThisMonth, today]);

  const monthPages = +monthBar.reduce((s, d) => s + d.pages, 0).toFixed(1);
  const monthActiveDays = monthBar.filter((d) => d.pages > 0).length;
  const monthName = monthLabel(month, today);
  const prevMonthName = monthLabel(addMonths(month, -1), today);

  // ── Personal insights + advice (mine scope) ───────────────────────────────
  // Signals + phrasing live in src/lib/insights.ts (pure, node-testable).
  // Seed = user + week Monday: stable within a week, rotates the next.
  const personal = useMemo(() => {
    const mine = entries.filter((e) => e.user_id === userId);
    const mineAllTime = readingAll.filter((r) => r.user_id === userId);
    const signals = computeSignals({
      mine,
      mineAllTime,
      mineDays,
      streak,
      longestStreak: longest,
      tz,
      today,
    });
    const seedBase = `${userId.slice(0, 8)}:${startOfWeek(today)}`;
    return {
      signals,
      insights: buildPersonalInsights(signals, { seedBase, includeEta: !reading }),
      advice: buildAdvice(signals, seedBase),
    };
  }, [entries, readingAll, userId, mineDays, streak, longest, tz, today, reading]);

  // ── Week recap (mine scope; the Sunday push deep-links here) ──────────────
  const recap = useMemo(() => {
    const monday = startOfWeek(today);
    const days = weekDates(monday).map((d) => ({
      d,
      logged: mineDays.has(d),
      future: d > today,
      isToday: d === today,
    }));
    const mine = entries.filter((e) => e.user_id === userId);
    const weekSet = new Set(weekDatesUpTo(monday, today));
    const refs = mine
      .filter(
        (e) =>
          (e.entry_type === "reading" || e.entry_type === "revising") &&
          e.to_ref &&
          weekSet.has(localDate(e.logged_at, tz)),
      )
      .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
    const firstPage = refs.length ? pageFromRef(refs[0].to_ref) : null;
    const lastRef = refs.length ? refs[refs.length - 1] : null;
    const lastPage = lastRef ? pageFromRef(lastRef.to_ref) : null;
    return {
      monday,
      label: weekRangeLabel(monday, days[6].d),
      days,
      activeDays: days.filter((x) => x.logged).length,
      movement:
        firstPage != null && lastPage != null && lastRef
          ? {
              from: firstPage,
              to: lastPage,
              surah: surahForPage(
                (lastRef.mushaf ?? "uthmani15") as Parameters<typeof surahForPage>[0],
                lastPage,
              ).name,
            }
          : null,
    };
  }, [entries, userId, mineDays, tz, today]);

  // The Sunday push lands on /stats#recap - bring the card into view.
  useEffect(() => {
    if (window.location.hash === "#recap") {
      // After paint, so layout is settled before we scroll.
      requestAnimationFrame(() => {
        document.getElementById("recap")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    // Calendar weeks (Mon-based). The current week is partial, so compare it
    // against the *same span* of last week - "Mon–Wed vs Mon–Wed" - otherwise
    // every Monday would look like a collapse against a full 7-day week.
    const week = new Set(thisWeekDates);
    const prevWeek = new Set(
      weekDates(addWeeks(today, -1)).slice(0, thisWeekDates.length),
    );
    const out: {
      icon: LucideIcon;
      text: React.ReactNode;
      delta?: number | null;
    }[] = [];

    const pagesIn = (rows: LogRow[], days: Set<string>) =>
      pagesOf(rows.filter((e) => days.has(localDate(e.logged_at, tz))));

    if (scope === "mine") {
      const minRows = entries.filter((e) => e.user_id === userId);
      // The generic personal lines (trend, streak, consistency, patterns,
      // ETA) now come from src/lib/insights.ts via the `personal` memo -
      // this branch only contributes the hifz-specific revision reads.

      // Most revised juz (structured logging).
      const revRows = minRows.filter(
        (e) =>
          (e.entry_type === "sabak_para" || e.entry_type === "dor") &&
          e.juz != null,
      );
      if (revRows.length > 0) {
        const byJuz = new Map<number, number>();
        for (const e of revRows) byJuz.set(e.juz!, (byJuz.get(e.juz!) ?? 0) + 1);
        const [topJuz, topN] = [...byJuz.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0];
        out.push({
          icon: BookMarked,
          text: (
            <>
              Most revised: <b>Juz {topJuz}</b>{" "}
              <span className="text-faint">· {topN}×</span>
            </>
          ),
        });

        // Longest-untouched juz you do revise.
        if (byJuz.size > 1) {
          const lastSeen = new Map<number, string>();
          for (const e of revRows) {
            const d = localDate(e.logged_at, tz);
            const cur = lastSeen.get(e.juz!);
            if (!cur || d > cur) lastSeen.set(e.juz!, d);
          }
          const [staleJuz, staleDate] = [...lastSeen.entries()].sort((a, b) =>
            a[1] < b[1] ? -1 : 1,
          )[0];
          const staleDays = Math.floor(
            (new Date(`${today}T12:00:00`).getTime() -
              new Date(`${staleDate}T12:00:00`).getTime()) /
              86400000,
          );
          if (staleDays >= 10) {
            out.push({
              icon: Hourglass,
              text: (
                <>
                  <b>Juz {staleJuz}</b> hasn’t been revised in{" "}
                  <b>{staleDays}</b> days
                </>
              ),
            });
          }
        }
      }

    } else {
      const activeMembers = new Set(
        entries
          .filter((e) => week.has(localDate(e.logged_at, tz)))
          .map((e) => e.user_id),
      ).size;
      out.push({
        icon: Users,
        text: (
          <>
            <b>{activeMembers}</b> of <b>{memberCount}</b> logged this week
          </>
        ),
      });

      // Same correction as the personal trend: the circle pushes hard in the
      // last week of the month, so a plain week-over-week number reads as a
      // crash the week after. The bar is a typical week instead
      // (src/lib/insights.ts → weekBaseline).
      const thisW = pagesIn(entries, week);
      const lastW = pagesIn(entries, prevWeek);
      const base = weekBaseline(
        pagesByDay(entries, tz),
        today,
        thisWeekDates.length,
      );
      const usual =
        base.weeks >= 3 && base.typicalSpan > 0 ? base.typicalSpan : null;
      out.push({
        icon: thisW >= (usual ?? lastW) ? TrendingUp : TrendingDown,
        text: (
          <>
            <b>{thisW}</b> group pages this week{" "}
            <span className="text-faint">
              {"· "}
              {usual != null
                ? `${usual} is typical by now`
                : `${lastW} same days last week`}
            </span>
          </>
        ),
        delta:
          thisW === 0
            ? null
            : usual != null
              ? (thisW - usual) / usual
              : lastW > 0
                ? (thisW - lastW) / lastW
                : null,
      });

      // Call a push a push, so next week's number isn't read as a slump.
      if (base.lastWeek?.outlier === "high" && thisW < base.lastWeek.pages) {
        out.push({
          icon: Activity,
          text: (
            <>
              Last week was a push: <b>{base.lastWeek.pages}</b> pages{" "}
              <span className="text-faint">
                · {base.typicalWeek} in a typical week
              </span>
            </>
          ),
        });
      }

      // Top contributor this week.
      const byUser = new Map<string, number>();
      for (const e of entries) {
        if (!week.has(localDate(e.logged_at, tz))) continue;
        byUser.set(
          e.user_id,
          (byUser.get(e.user_id) ?? 0) + (e.pages_equiv ? +e.pages_equiv : 0),
        );
      }
      const top = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0) {
        const name =
          top[0] === userId
            ? "You"
            : (members.find((m) => m.user_id === top[0])?.display_name ??
              "Someone");
        out.push({
          icon: Trophy,
          text: (
            <>
              Most pages this week: <b>{name}</b>{" "}
              <span className="text-faint">· {+top[1].toFixed(1)} pages</span>
            </>
          ),
        });
      }
    }
    return out;
  }, [
    scope,
    entries,
    userId,
    tz,
    today,
    thisWeekDates,
    members,
    memberCount,
  ]);

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-8">
      <header className="px-5 pt-7 pb-3">
        <h1 className="text-display">Insights</h1>
      </header>

      <div className="space-y-4 px-5">
        {/* All / Sabak / Sabak Para / Dhor - hifz, personal scope only. Scopes
            the heatmap and weekly pages below. */}
        {!reading && scope === "mine" && (
          <div className="flex rounded-xl bg-surface-2 p-1 text-footnote">
            {(
              [
                { v: "all", label: "All" },
                { v: "sabak", label: "Sabak" },
                { v: "sabak_para", label: "Sabak Para" },
                { v: "dor", label: "Dhor" },
              ] as { v: Filter; label: string }[]
            ).map((s) => (
              <button
                key={s.v}
                onClick={() => setFilter(s.v)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 font-medium transition-colors",
                  filter === s.v
                    ? "bg-surface text-foreground shadow-e1"
                    : "text-muted",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-footnote text-faint">
            {scope === "mine" ? "Your" : "Group"} activity
          </p>
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-caption font-medium">
            {(["mine", "group"] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  "rounded-md px-2.5 py-1 capitalize transition-colors",
                  scope === s
                    ? "bg-surface text-foreground shadow-e1"
                    : "text-muted",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── MINE: week recap - the Sunday push deep-links here (#recap) ── */}
        {scope === "mine" && (
          <div id="recap" className="scroll-mt-4 rounded-2xl bg-surface p-4 shadow-e1">
            <div className="flex items-start justify-between">
              <p className="text-callout font-semibold">Your week</p>
              <span className="text-caption text-faint">{recap.label}</span>
            </div>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-display tabular-nums">
                {personal.signals.pagesThisWeek}
              </span>
              <span className="text-callout text-muted">
                {personal.signals.pagesThisWeek === 1 ? "page" : "pages"} ·{" "}
                {recap.activeDays} of 7 days
              </span>
            </div>
            {/* Lead with a typical week: one outstanding week shouldn't make
                the next one look like a collapse (insights.ts → weekBaseline). */}
            <p className="mt-0.5 text-footnote text-faint">
              {personal.signals.baseline.weeks >= 3 &&
              personal.signals.baseline.typicalSpan > 0
                ? `Usually ${personal.signals.baseline.typicalSpan} by this point · last week ${personal.signals.pagesSameSpanLastWeek}`
                : `${personal.signals.pagesSameSpanLastWeek} by this point last week`}
              {personal.signals.bestWeek &&
              personal.signals.pagesThisWeek > personal.signals.bestWeek.pages
                ? " · your best week yet 🎉"
                : ""}
            </p>

            {/* The seven days, Monday → Sunday */}
            <div className="mt-3 flex justify-between">
              {recap.days.map((day, i) => (
                <div key={day.d} className="flex flex-col items-center gap-1">
                  <span className="text-caption text-faint">{WEEKDAYS[i]}</span>
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-full text-caption font-semibold",
                      day.logged
                        ? "bg-accent text-white"
                        : day.future
                          ? "bg-surface-2 text-faint opacity-40"
                          : "bg-surface-2 text-faint",
                      day.isToday && !day.logged && "ring-1 ring-accent",
                    )}
                  >
                    {day.logged ? "✓" : +day.d.slice(8, 10)}
                  </span>
                </div>
              ))}
            </div>

            {recap.movement && (
              <p className="mt-3 text-footnote text-muted">
                Bookmark this week: p.{recap.movement.from}
                {recap.movement.to !== recap.movement.from
                  ? ` → p.${recap.movement.to}`
                  : ""}{" "}
                · {recap.movement.surah}
              </p>
            )}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3">
          {scope === "mine" ? (
            <>
              <StatCard
                label="All-time pages"
                value={totals.myAll}
                sub={`≈ ${Math.round(totals.myAll / 20)} juz`}
                onInfo={() => setShowCoverage(true)}
              />
              <StatCard label="Current streak" value={streak} sub="days" />
              <StatCard label="Longest streak" value={longest} sub="days" />
              <StatCard
                label="This week"
                value={weekCount}
                sub={`entries · since ${shortDate(thisWeekDates[0])}`}
              />
            </>
          ) : (
            <>
              <StatCard
                label="All-time pages"
                value={groupRead}
                sub={
                  khatmahs > 0
                    ? `${khatmahs} ${khatmahs === 1 ? "khatmah" : "khatmahs"} + ${Math.floor(khatmahProgress)} pages`
                    : "read together"
                }
                onInfo={() => setShowCoverage(true)}
              />
              <StatCard
                label="Logged today"
                value={`${loggedTodayCount}/${memberCount}`}
                sub="members"
              />
              <StatCard
                label="This week"
                value={weekCount}
                sub={`entries · since ${shortDate(thisWeekDates[0])}`}
              />
              <StatCard
                label="Khatmahs"
                value={khatmahs}
                sub="completed together"
              />
            </>
          )}
        </div>

        {/* ── MINE: where you are in the Quran, month by month ── */}
        {scope === "mine" && (
          <ProgressCard mode={mode} tz={tz} today={today} mushaf={mushaf} rows={mine} />
        )}

        {/* ── MINE (hifz): Sabak / Sabak Para / Dhor, in pages ── */}
        {!reading && scope === "mine" && (
          <HifzBreakdownCard rows={mine} tz={tz} today={today} />
        )}

        {/* ── GROUP: the khatmah we're on + history of past ones ── */}
        {scope === "group" && <KhatmahCard rows={readingAll} tz={tz} today={today} />}

        {/* ── Month browser: page back through any past month ── */}
        <div className="rounded-2xl bg-surface p-4 shadow-e1">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setMonth(addMonths(month, -1))}
              disabled={!canGoBack}
              aria-label="Previous month"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted transition-opacity disabled:opacity-30"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="min-w-0 text-center">
              <p className="text-callout font-semibold">{monthName}</p>
              <p className="text-caption text-faint">
                {isThisMonth ? `1–${+today.slice(8, 10)} so far` : "full month"}
              </p>
            </div>
            <button
              onClick={() => setMonth(addMonths(month, 1))}
              disabled={isThisMonth}
              aria-label="Next month"
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted transition-opacity disabled:opacity-30"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-display tabular-nums">
              {scope === "mine" ? totals.myMonth : totals.groupMonth}
            </span>
            <span className="text-callout text-muted">
              pages {scope === "mine" ? "read" : "read together"}
            </span>
            <span className="text-footnote text-faint">
              ≈{" "}
              {Math.round(
                (scope === "mine" ? totals.myMonth : totals.groupMonth) / 20,
              )}{" "}
              juz
            </span>
          </div>
          {/* Name the month in both clauses - the active-day count belongs to
              the selected month, not the comparison month. */}
          <p className="mt-0.5 text-footnote text-faint">
            {monthActiveDays > 0 &&
              `Logged on ${monthActiveDays} ${
                monthActiveDays === 1 ? "day" : "days"
              } in ${monthName} · `}
            {prevMonthName} total:{" "}
            {scope === "mine" ? totals.myPrevMonth : totals.groupPrevMonth} pages
          </p>

          {monthPages === 0 ? (
            <p className="mt-4 text-footnote text-faint">
              Nothing logged in {monthName}.
            </p>
          ) : (
            <div className="mt-3 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthBar}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke={colors.grid}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: colors.tick }}
                    interval={monthBar.length > 20 ? 4 : 2}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: colors.tick }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    content={({ active, payload }) => (
                      <TooltipCard
                        active={active}
                        label={payload?.[0]?.payload?.full}
                        value={payload?.[0]?.value as number}
                        suffix="pages"
                      />
                    )}
                  />
                  <Bar
                    dataKey="pages"
                    fill={colors.accent}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={14}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── GROUP: leaderboard - this month + all time per member ── */}
        {scope === "group" && (
          <Card title={`Leaderboard · ${monthName}`}>
            <div className="space-y-3">
              {totals.board.map((row, i) => (
                <div key={row.member.user_id} className="flex items-center gap-3">
                  <span className="w-4 shrink-0 text-center text-footnote tabular-nums text-faint">
                    {i + 1}
                  </span>
                  <Avatar
                    name={row.member.display_name}
                    src={row.member.avatar_url}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-subhead font-medium">
                        {row.member.user_id === userId
                          ? "You"
                          : row.member.display_name}
                        {i === 0 && row.month > 0 && (
                          <Trophy className="mb-0.5 ml-1.5 inline size-3.5 text-accent" />
                        )}
                      </p>
                      <p className="shrink-0 text-subhead font-semibold tabular-nums">
                        {row.month}
                        <span className="ml-1 font-normal text-faint">
                          · {row.all} all time
                        </span>
                      </p>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-500"
                        style={{ width: `${(row.month / totals.maxMonth) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-caption text-faint">
              Pages in {monthName} · every entry type counts
            </p>
          </Card>
        )}

        {/* Insights - mine: the personal engine + hifz extras + one piece of
            advice; group: the existing aggregate lines. */}
        {scope === "mine" ? (
          <Card title="Trends & insights">
            <div className="space-y-3">
              {personal.insights.map((ins) => {
                const Icon = INSIGHT_ICONS[ins.kind] ?? CalendarCheck;
                const TrendIcon =
                  ins.kind === "trend"
                    ? (ins.delta ?? 0) >= 0
                      ? TrendingUp
                      : TrendingDown
                    : Icon;
                return (
                  <div key={ins.kind} className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                      <TrendIcon className="size-4.5" />
                    </span>
                    <p className="min-w-0 flex-1 text-subhead text-foreground">
                      {emphasize(ins.text)}
                    </p>
                    {ins.delta != null && <DeltaBadge value={ins.delta} />}
                  </div>
                );
              })}
              {insights.map((ins, i) => (
                <div key={`hifz-${i}`} className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                    <ins.icon className="size-4.5" />
                  </span>
                  <p className="min-w-0 flex-1 text-subhead text-foreground [&_b]:font-semibold">
                    {ins.text}
                  </p>
                  {ins.delta != null && <DeltaBadge value={ins.delta} />}
                </div>
              ))}
            </div>
            {/* One practical suggestion, reacting to your actual patterns. */}
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-accent-tint px-3 py-2.5">
              <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" />
              <p className="min-w-0 flex-1 text-footnote font-medium text-accent">
                {personal.advice}
              </p>
            </div>
          </Card>
        ) : (
          insights.length > 0 && (
            <Card title="Trends & insights">
              <div className="space-y-3">
                {insights.map((ins, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                      <ins.icon className="size-4.5" />
                    </span>
                    <p className="min-w-0 flex-1 text-subhead text-foreground [&_b]:font-semibold">
                      {ins.text}
                    </p>
                    {ins.delta != null && <DeltaBadge value={ins.delta} />}
                  </div>
                ))}
              </div>
            </Card>
          )
        )}

        {/* Entries heatmap */}
        <Card title="Entries · last 5 weeks (Mon–Sun)">
          {totalEntries === 0 ? (
            <Empty>No entries in this view yet.</Empty>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((w, i) => (
                  <span key={i} className="text-center text-caption text-faint">
                    {w}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {heatGrid.map((cell, i) =>
                  cell === null ? (
                    <div key={i} className="aspect-square" />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        setActiveCell((v) => (v === i ? null : i))
                      }
                      className="group relative aspect-square"
                    >
                      <span
                        className={cn(
                          "block size-full rounded-md",
                          cell.op === 0 ? "bg-surface-2" : "bg-accent",
                        )}
                        style={cell.op === 0 ? undefined : { opacity: cell.op }}
                      />
                      <span
                        className={cn(
                          "pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-caption shadow-e2 opacity-0 transition-opacity group-hover:opacity-100",
                          activeCell === i && "opacity-100",
                        )}
                      >
                        <span className="font-semibold tabular-nums">
                          {cell.count}
                        </span>{" "}
                        {cell.count === 1 ? "entry" : "entries"}
                        <span className="text-faint"> · {dayLabel(cell.date)}</span>
                      </span>
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </Card>

        {/* ── MINE: daily pages + weekly trend ── */}
        {scope === "mine" && (
          <>
            <Card title="Weekly pages · last 8 weeks (Mon–Sun)">
              {weeklyTotal === 0 ? (
                <Empty>Log a few weeks of pages to see your trend here.</Empty>
              ) : (
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart
                    data={weeklyBar}
                    margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke={colors.grid} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: colors.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={1}
                    />
                    <YAxis
                      tick={{ fill: colors.tick, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={28}
                    />
                    <Tooltip
                      cursor={{ fill: colors.surface2 }}
                      content={({ active, payload }) => (
                        <TooltipCard
                          active={active}
                          label={payload?.[0]?.payload?.full}
                          value={payload?.[0]?.value as number}
                          suffix="pages"
                        />
                      )}
                    />
                    <Bar
                      dataKey="pages"
                      isAnimationActive={false}
                      fill={colors.accent}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={26}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </>
        )}

        {/* ── MINE: notes live in the Journal ── */}
        {scope === "mine" && (
          <Link
            href="/journal"
            className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-e1"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-tint text-accent">
              <NotebookPen className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-callout font-semibold">Journal</span>
              <span className="block text-footnote text-muted">
                {noteCount > 0
                  ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}, by day or by juz`
                  : "Every entry you’ve logged, by day or by juz"}
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-faint" />
          </Link>
        )}
      </div>

      {/* Where these numbers come from - totals only count what was logged. */}
      <Sheet
        open={showCoverage}
        onClose={() => setShowCoverage(false)}
        labelledBy="coverage-title"
      >
        <div className="px-5 pt-2 pb-2">
          <h2 id="coverage-title" className="text-title2">
            About these numbers
          </h2>
          <div className="mt-4 space-y-3 text-subhead text-muted">
            <p>
              Every total here is built from what’s been logged in Iqra, nothing
              else. If you read without logging it, or started reading before
              joining, that isn’t counted.
            </p>
            <p>
              So treat these as{" "}
              <b className="font-semibold text-foreground">
                a record of what we’ve tracked together
              </b>
              , not a complete account of what anyone has read. The real number
              is only ever higher.
            </p>
            <p>
              Pages are normalised to the 604-page Uthmani mushaf, so a juz
              counts as 20 pages and a quarter as 5. Entries logged in ayahs
              don’t carry a page count and sit outside these totals.
            </p>
          </div>
          <Button
            fullWidth
            className="mt-6"
            onClick={() => setShowCoverage(false)}
          >
            Got it
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/** ▲ 12% / ▼ 8% / - steady. Icon + number together, never color alone. */
function DeltaBadge({ value }: { value: number }) {
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-caption font-medium text-muted">
        <Minus className="size-3" /> steady
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums",
        up ? "bg-accent-tint text-accent" : "bg-danger-tint text-danger",
      )}
    >
      {up ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
      )}
      {pct > 999 ? ">999" : pct}%
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  onInfo,
}: {
  label: string;
  value: number | string;
  sub: string;
  /** When set, shows an info affordance explaining where the number comes from. */
  onInfo?: () => void;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <div className="flex items-start justify-between gap-1">
        <p className="text-footnote font-medium text-muted">{label}</p>
        {onInfo && (
          <button
            onClick={onInfo}
            aria-label={`About ${label}`}
            className="-mr-1 -mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-faint"
          >
            <Info className="size-3.5" />
          </button>
        )}
      </div>
      <p className="mt-2 text-title1 tabular-nums">{value}</p>
      <p className="text-footnote text-faint">{sub}</p>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <p className="mb-3 text-callout font-semibold">{title}</p>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <TrendingUp className="size-6 text-faint" />
      <p className="max-w-[15rem] text-footnote text-muted">{children}</p>
    </div>
  );
}
