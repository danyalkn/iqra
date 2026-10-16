"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Mode } from "@/lib/entries";
import { dayLabel, lastNDaysEndingOn, localDate, monthKey, monthLabel } from "@/lib/dates";
import {
  juzForPage,
  juzStartPages,
  surahForPage,
  type MushafId,
} from "@/lib/mushaf";
import { juzLength, pagesPhrase, positionLabel, rowJuzPage } from "@/lib/position";
import {
  dayStamp,
  hifzProgress,
  monthSpans,
  readingProgress,
  timeTicks,
  type JuzCoverage,
  type ProgressRow,
} from "@/lib/progress";
import { cn } from "@/lib/cn";
import { TooltipCard, useChartColors } from "./chartKit";

type View = "hifz" | "reading";

const fmt = (n: number) => String(+n.toFixed(2));

/**
 * "Where you are" - your place in the Quran and how it has moved, month by
 * month. Memorizers see their latest sabak, the juz it's in, and their new
 * memorization over time; readers see their bookmark over time.
 */
export function ProgressCard({
  mode,
  tz,
  today,
  mushaf,
  rows,
}: {
  mode: Mode;
  tz: string;
  today: string;
  mushaf: MushafId;
  /** The signed-in user's entries, all time. */
  rows: ProgressRow[];
}) {
  const reading = useMemo(() => readingProgress(rows, tz), [rows, tz]);
  const hifz = useMemo(() => hifzProgress(rows, tz, mushaf), [rows, tz, mushaf]);
  const [view, setView] = useState<View>(mode === "hifz" && hifz ? "hifz" : "reading");

  const both = !!reading && !!hifz;
  const active: View = both ? view : hifz ? "hifz" : "reading";

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-callout font-semibold">Where you are</p>
        {both && (
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-caption font-medium">
            {(
              [
                { v: "hifz", label: "Memorizing" },
                { v: "reading", label: "Reading" },
              ] as { v: View; label: string }[]
            ).map((o) => (
              <button
                key={o.v}
                onClick={() => setView(o.v)}
                aria-pressed={view === o.v}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  view === o.v ? "bg-surface text-foreground shadow-e1" : "text-muted",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {active === "hifz" && hifz ? (
        <HifzView hifz={hifz} mushaf={mushaf} today={today} />
      ) : active === "reading" && reading ? (
        <ReadingView rows={rows} reading={reading} tz={tz} today={today} />
      ) : (
        <p className="text-footnote text-muted">
          {mode === "hifz"
            ? "Log a sabak and set where it starts, and your place in each juz shows up here."
            : "Log a reading with the last page you reached, and your place in the Quran shows up here, month by month."}
        </p>
      )}
    </div>
  );
}

// ── Memorizing ──────────────────────────────────────────────────────────────

function HifzView({
  hifz,
  mushaf,
  today,
}: {
  hifz: NonNullable<ReturnType<typeof hifzProgress>>;
  mushaf: MushafId;
  today: string;
}) {
  const colors = useChartColors();
  const latest = hifz.latest;
  const juz = latest.juz!;
  const start = rowJuzPage(latest);
  const cov = hifz.coverage.get(juz)!;
  const juzCount = hifz.coverage.size;
  const months = monthSpans(hifz.trail, (p) => p.total).slice(0, 3);

  const first = hifz.trail[0].t;
  const end = Math.max(hifz.trail[hifz.trail.length - 1].t, dayStamp(today));
  const xTicks = timeTicks(first, end);
  const data = [...hifz.trail];
  // Carry the total to today so the line reads "still here", not "stopped".
  if (data[data.length - 1].t < end) {
    data.push({ date: today, t: end, total: data[data.length - 1].total });
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-display">Juz {juz}</span>
        <span className="text-callout text-muted">
          {start != null ? positionLabel(start, latest.amount) : "latest sabak"}
        </span>
      </div>
      <p className="mt-0.5 text-footnote text-muted">
        {fmt(cov.covered)} of {cov.length} pages of Juz {juz} logged as sabak
        {cov.unplaced > 0 && cov.quarters.size > 0
          ? ` (${fmt(cov.unplaced)} without a set start)`
          : ""}
      </p>

      <JuzPageGrid cov={cov} />
      {cov.quarters.size === 0 && (
        <p className="mt-1.5 text-caption text-faint">
          Set “Starts at” when you log a sabak and these squares fill in page by
          page, top half and bottom half.
        </p>
      )}

      {juzCount > 1 && <JuzMap coverage={hifz.coverage} mushaf={mushaf} />}

      <p className="mt-4 text-footnote font-medium text-muted">
        New memorization, all time
      </p>
      <p className="text-caption text-faint">
        {pagesPhrase(hifz.totalPages)} of sabak across {juzCount} juz
      </p>
      <div className="mt-2 h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={colors.grid} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[first, end]}
              ticks={xTicks.ticks}
              tickFormatter={xTicks.format}
              tick={{ fontSize: 10, fill: colors.tick }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, "auto"]}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: colors.tick }}
              axisLine={false}
              tickLine={false}
              width={30}
            />
            <Tooltip
              cursor={{ stroke: colors.grid }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as { date: string; total: number } | undefined;
                return (
                  <TooltipCard
                    active={active}
                    value={p ? fmt(p.total) : undefined}
                    suffix="pages"
                    label={p ? dayLabel(p.date) : undefined}
                  />
                );
              }}
            />
            <Line
              type="stepAfter"
              dataKey="total"
              stroke={colors.accent}
              strokeWidth={2}
              dot={data.length < 3 ? { r: 4, fill: colors.accent, stroke: colors.surface, strokeWidth: 2 } : false}
              activeDot={{ r: 4, fill: colors.accent, stroke: colors.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <MonthList
        today={today}
        rows={months.map((m) => {
          const gained = +(m.to - (m.before ?? 0)).toFixed(2);
          return {
            month: m.month,
            text: gained > 0 ? `+${pagesPhrase(gained)}` : "no new sabak",
          };
        })}
      />
    </>
  );
}

/** The latest juz, page by page: each page is two cells (top/bottom half);
 *  a half with only one of its quarters memorized is filled lighter. */
function JuzPageGrid({ cov }: { cov: JuzCoverage }) {
  const pages = Array.from({ length: cov.length }, (_, i) => i + 1);
  const halfState = (h: number) => {
    const n = (cov.quarters.has(h) ? 1 : 0) + (cov.quarters.has(h + 0.25) ? 1 : 0);
    return n === 2 ? "bg-accent" : n === 1 ? "bg-accent/45" : "bg-surface-2";
  };
  return (
    <div
      role="img"
      aria-label={`${fmt(cov.quarters.size / 4)} of ${cov.length} pages placed in Juz ${cov.juz}`}
      className="mt-3 grid gap-[2px]"
      style={{ gridTemplateColumns: `repeat(${cov.length}, minmax(0, 1fr))` }}
    >
      {pages.map((p) => (
        <span key={p} className="flex flex-col gap-[2px]">
          {[p, p + 0.5].map((h) => (
            <span key={h} className={cn("h-2.5 rounded-[2px]", halfState(h))} />
          ))}
        </span>
      ))}
    </div>
  );
}

/** Every juz with sabak logged, filled by how much of it is covered. */
function JuzMap({
  coverage,
  mushaf,
}: {
  coverage: Map<number, JuzCoverage>;
  mushaf: MushafId;
}) {
  return (
    <div className="mt-4">
      <p className="text-footnote font-medium text-muted">Sabak by juz</p>
      <div
        role="img"
        aria-label={`Sabak logged in ${coverage.size} juz`}
        className="mt-1.5 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[2px]"
      >
        {Array.from({ length: 30 }, (_, i) => {
          const c = coverage.get(i + 1);
          const frac = c ? c.covered / juzLength(mushaf, i + 1) : 0;
          return (
            <span
              key={i}
              className="relative h-3.5 overflow-hidden rounded-[3px] bg-surface-2"
              title={c ? `Juz ${i + 1}: ${fmt(c.covered)} pages` : `Juz ${i + 1}`}
            >
              {frac > 0 && (
                <span
                  className="absolute inset-x-0 bottom-0 bg-accent"
                  style={{ height: `${Math.max(15, frac * 100)}%` }}
                />
              )}
            </span>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-caption text-faint">
        <span>Juz 1</span>
        <span>Juz 30</span>
      </div>
    </div>
  );
}

// ── Reading ─────────────────────────────────────────────────────────────────

function ReadingView({
  rows,
  reading,
  tz,
  today,
}: {
  rows: ProgressRow[];
  reading: NonNullable<ReturnType<typeof readingProgress>>;
  tz: string;
  today: string;
}) {
  const colors = useChartColors();

  // Is the bookmark current? Yes if any of the last three readings set a
  // last page (one backdated entry without a page doesn't make it stale).
  const reads = useMemo(
    () =>
      rows
        .filter((r) => r.entry_type === "reading" || r.entry_type === "revising")
        .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime()),
    [rows],
  );
  const current = reads.slice(-3).some((r) => !!r.to_ref);

  // Pages read per day, cumulative (the fallback when the bookmark is stale).
  const cumulative = useMemo(() => {
    const out: { date: string; t: number; total: number }[] = [];
    let total = 0;
    for (const r of reads) {
      total += r.pages_equiv ? +r.pages_equiv : 0;
      const date = localDate(r.logged_at, tz);
      const last = out[out.length - 1];
      if (last && last.date === date) last.total = +total.toFixed(1);
      else out.push({ date, t: dayStamp(date), total: +total.toFixed(1) });
    }
    return out;
  }, [reads, tz]);

  // Pace over the last 14 days for the finish estimate (reading pages only),
  // or over however many days there are when reading started more recently.
  const pace = useMemo(() => {
    if (reads.length === 0) return 0;
    const window = lastNDaysEndingOn(today, 14);
    const firstDay = localDate(reads[0].logged_at, tz);
    const span = window.filter((d) => d >= firstDay).length || 1;
    const days = new Set(window);
    return (
      reads.reduce(
        (s, r) => (days.has(localDate(r.logged_at, tz)) ? s + (r.pages_equiv ? +r.pages_equiv : 0) : s),
        0,
      ) / span
    );
  }, [reads, tz, today]);

  const { page, total, mushaf, khatms } = reading;
  const juz = juzForPage(mushaf, page);
  const surah = surahForPage(mushaf, page);
  const left = total - page;
  const etaDays = pace > 0 && left > 0 ? Math.ceil(left / pace) : null;

  const series = current ? reading.trail : cumulative;
  const first = series[0].t;
  const end = Math.max(series[series.length - 1].t, dayStamp(today));
  const data = current
    ? reading.trail.map((p) => ({ date: p.date, t: p.t, v: p.page }))
    : cumulative.map((p) => ({ date: p.date, t: p.t, v: p.total }));
  if (data[data.length - 1].t < end) {
    data.push({ date: today, t: end, v: data[data.length - 1].v });
  }
  const juzTicks = [1, 10, 20, 30].map((j) => juzStartPages(mushaf)[j - 1]);
  const xTicks = timeTicks(first, end);
  const maxCum = cumulative.length ? cumulative[cumulative.length - 1].total : 0;

  const months = current
    ? readingMonths(reading.trail, total).slice(0, 3)
    : monthSpans(cumulative, (p) => p.total)
        .slice(0, 3)
        .map((m) => ({
          month: m.month,
          text: `+${+(m.to - (m.before ?? 0)).toFixed(1)} pages`,
        }));

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-display">Juz {juz}</span>
        <span className="text-callout text-muted">{surah.name}</span>
        <span dir="rtl" className="text-callout text-faint">
          {surah.arabic}
        </span>
      </div>
      <p className="mt-0.5 text-footnote text-muted">
        Page {page} of {total} · {Math.round((page / total) * 100)}% of the way
        through
        {khatms > 0 ? ` · khatm #${khatms + 1}` : ""}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(100, (page / total) * 100)}%` }}
        />
      </div>
      {current ? (
        etaDays && (
          <p className="mt-1.5 text-footnote text-faint">
            About {etaDays} {etaDays === 1 ? "day" : "days"} to finish at your
            pace
          </p>
        )
      ) : (
        <p className="mt-2 rounded-xl bg-warn-tint px-3 py-2 text-footnote text-warn">
          Your recent readings didn’t set a last page, so this bookmark may be
          behind. Leave “Continue from last page” on when you log to keep it
          current.
        </p>
      )}

      <p className="mt-4 text-footnote font-medium text-muted">
        {current ? "Your place, month by month" : "Pages read, all time"}
      </p>
      <div className="mt-2 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={colors.grid} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[first, end]}
              ticks={xTicks.ticks}
              tickFormatter={xTicks.format}
              tick={{ fontSize: 10, fill: colors.tick }}
              axisLine={false}
              tickLine={false}
            />
            {current ? (
              <YAxis
                domain={[1, total]}
                ticks={juzTicks}
                tickFormatter={(p: number) => `Juz ${juzForPage(mushaf, p)}`}
                tick={{ fontSize: 10, fill: colors.tick }}
                axisLine={false}
                tickLine={false}
                width={54}
              />
            ) : (
              <YAxis
                domain={[0, "auto"]}
                allowDecimals={false}
                tick={{ fontSize: 10, fill: colors.tick }}
                axisLine={false}
                tickLine={false}
                width={34}
              />
            )}
            {!current && maxCum >= total * 0.6 && (
              <ReferenceLine
                y={total}
                stroke={colors.tick}
                label={{ value: "1 khatmah", position: "insideTopLeft", fontSize: 10, fill: colors.tick }}
              />
            )}
            <Tooltip
              cursor={{ stroke: colors.grid }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as { date: string; v: number } | undefined;
                return current ? (
                  <TooltipCard
                    active={active}
                    value={p ? `p.${p.v}` : undefined}
                    detail={
                      p
                        ? `Juz ${juzForPage(mushaf, p.v)} · ${surahForPage(mushaf, p.v).name}`
                        : undefined
                    }
                    label={p ? dayLabel(p.date) : undefined}
                  />
                ) : (
                  <TooltipCard
                    active={active}
                    value={p?.v}
                    suffix="pages read"
                    label={p ? dayLabel(p.date) : undefined}
                  />
                );
              }}
            />
            <Line
              type="linear"
              dataKey="v"
              stroke={colors.accent}
              strokeWidth={2}
              dot={data.length < 3 ? { r: 4, fill: colors.accent, stroke: colors.surface, strokeWidth: 2 } : false}
              activeDot={{ r: 4, fill: colors.accent, stroke: colors.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <MonthList today={today} rows={months} />
    </>
  );
}

/** Bookmark movement per month, newest first. Counts khatm wraps inside the
 *  month so finishing one never reads as the bookmark going backwards. */
function readingMonths(
  trail: { date: string; page: number }[],
  total: number,
): { month: string; text: string }[] {
  const months: { month: string; start: number | null; first: number; to: number; wraps: number }[] = [];
  let prev: number | null = null;
  for (const p of trail) {
    const month = monthKey(p.date);
    let cur = months[months.length - 1];
    if (!cur || cur.month !== month) {
      cur = { month, start: prev, first: p.page, to: p.page, wraps: 0 };
      months.push(cur);
    }
    if (prev != null && p.page < prev && prev - p.page > total / 2) cur.wraps++;
    cur.to = p.page;
    prev = p.page;
  }
  return months.reverse().map((m) => {
    const from = m.start ?? m.first;
    const text =
      m.wraps > 0
        ? `finished ${m.wraps === 1 ? "a khatm" : `${m.wraps} khatms`}, now p.${m.to}`
        : from === m.to
          ? m.start == null
            ? `started at p.${m.to}`
            : `stayed on p.${m.to}`
          : `p.${from} to p.${m.to}`;
    return { month: m.month, text };
  });
}

/** Newest months first: the month-by-month stat under each chart. */
function MonthList({
  today,
  rows,
}: {
  today: string;
  rows: { month: string; text: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 divide-y divide-border border-t border-border">
      {rows.map((r) => (
        <div key={r.month} className="flex items-baseline justify-between py-2">
          <span className="text-footnote text-muted">{monthLabel(r.month, today)}</span>
          <span className="text-footnote font-medium">{r.text}</span>
        </div>
      ))}
    </div>
  );
}
