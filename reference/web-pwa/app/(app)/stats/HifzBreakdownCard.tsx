"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ENTRY_META } from "@/lib/entries";
import {
  addWeeks,
  localDate,
  shortDate,
  startOfWeek,
  weekDatesUpTo,
  weekRangeLabel,
} from "@/lib/dates";
import { describeEntry } from "@/lib/format";
import type { LogRow } from "@/lib/types";
import { TooltipCard, useChartColors, type ChartColors } from "./chartKit";

type HifzType = "sabak" | "sabak_para" | "dor";
/** Newest material first: Sabak, then Sabak Para, then Dhor. */
const TYPES: HifzType[] = ["sabak", "sabak_para", "dor"];
const WEEKS = 8;

const SHORT_DESC: Record<HifzType, string> = {
  sabak: "New lesson",
  sabak_para: "Recent revision",
  dor: "Old revision",
};

const colorOf = (c: ChartColors, t: HifzType) =>
  t === "sabak" ? c.chart1 : t === "sabak_para" ? c.chart2 : c.chart3;
// Legend swatches are HTML, so they can read the tokens directly (no flash).
const CSS_VAR: Record<HifzType, string> = {
  sabak: "var(--chart-1)",
  sabak_para: "var(--chart-2)",
  dor: "var(--chart-3)",
};

type Week = { label: string; full: string } & Record<HifzType, number>;

const r1 = (n: number) => +n.toFixed(2);

/** "today" / "yesterday" / "5 days ago" / "12 Jul". */
function ago(ymd: string, today: string): string {
  const days = Math.round(
    (new Date(`${today}T12:00:00`).getTime() - new Date(`${ymd}T12:00:00`).getTime()) /
      86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return shortDate(ymd);
}

/**
 * Sabak, Sabak Para and Dhor one under the other: pages per calendar week
 * for each type, plus what each one last covered. Replaces the old
 * entry-count donut, which lumped both revision types together and counted
 * a full juz of Dhor the same as a quarter page of Sabak.
 */
export function HifzBreakdownCard({
  rows,
  tz,
  today,
}: {
  /** The signed-in user's entries, all time. */
  rows: LogRow[];
  tz: string;
  today: string;
}) {
  const colors = useChartColors();

  const { weeks, totals, latest, any } = useMemo(() => {
    const firstMonday = addWeeks(today, -(WEEKS - 1));
    const weeks: Week[] = [];
    const index = new Map<string, Week>();
    for (let w = WEEKS - 1; w >= 0; w--) {
      const monday = addWeeks(today, -w);
      const dates = weekDatesUpTo(monday, today);
      const range = weekRangeLabel(monday, dates[dates.length - 1]);
      const week: Week = {
        label: shortDate(monday),
        full: dates.length < 7 ? `${range} · so far` : range,
        sabak: 0,
        sabak_para: 0,
        dor: 0,
      };
      weeks.push(week);
      index.set(monday, week);
    }
    const totals: Record<HifzType, number> = { sabak: 0, sabak_para: 0, dor: 0 };
    const latest: Partial<Record<HifzType, LogRow>> = {};
    for (const r of rows) {
      if (!TYPES.includes(r.entry_type as HifzType)) continue;
      const t = r.entry_type as HifzType;
      const prev = latest[t];
      if (!prev || new Date(r.logged_at) > new Date(prev.logged_at)) latest[t] = r;
      const date = localDate(r.logged_at, tz);
      const monday = startOfWeek(date);
      if (monday < firstMonday) continue;
      const week = index.get(monday);
      if (!week) continue;
      const pages = r.pages_equiv ? +r.pages_equiv : 0;
      week[t] = r1(week[t] + pages);
      totals[t] = r1(totals[t] + pages);
    }
    const any = TYPES.some((t) => totals[t] > 0);
    return { weeks, totals, latest, any };
  }, [rows, tz, today]);

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <p className="text-callout font-semibold">Sabak, Sabak Para & Dhor</p>
      <p className="text-caption text-faint">
        Pages per week, last {WEEKS} weeks · each on its own scale
      </p>

      {!any && (
        <p className="mt-3 text-footnote text-muted">
          No Sabak, Sabak Para or Dhor logged in the last {WEEKS} weeks.
        </p>
      )}

      {/* Small multiples: a half page of sabak would vanish stacked under a
          20-page dhor, so each type gets its own row and scale. */}
      <div className="mt-3 divide-y divide-border">
        {TYPES.map((t, i) => {
          const last = latest[t];
          const isLast = i === TYPES.length - 1;
          return (
            <div key={t} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="flex min-w-0 items-center gap-2 text-subhead font-medium">
                  <span
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: CSS_VAR[t] }}
                  />
                  <span className="truncate">
                    {ENTRY_META[t].label}{" "}
                    <span className="font-normal text-faint">· {SHORT_DESC[t]}</span>
                  </span>
                </p>
                <p className="shrink-0 text-subhead font-semibold tabular-nums">
                  {totals[t]}
                  <span className="ml-1 font-normal text-faint">
                    {totals[t] === 1 ? "page" : "pages"}
                  </span>
                </p>
              </div>
              <p className="mt-0.5 truncate pl-[1.125rem] text-footnote text-muted">
                {last
                  ? `Last: ${describeEntry(last)} · ${ago(localDate(last.logged_at, tz), today)}`
                  : "Not logged yet"}
              </p>
              {any && (
                <TypeBars
                  weeks={weeks}
                  type={t}
                  color={colorOf(colors, t)}
                  colors={colors}
                  showAxis={isLast}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One type's weekly pages. Only the tallest week is labelled; the tooltip
 *  and the total beside the title carry the rest. */
function TypeBars({
  weeks,
  type,
  color,
  colors,
  showAxis,
}: {
  weeks: Week[];
  type: HifzType;
  color: string;
  colors: ChartColors;
  showAxis: boolean;
}) {
  const max = Math.max(...weeks.map((w) => w[type]));
  return (
    <div className={showAxis ? "mt-1.5 h-[4.5rem]" : "mt-1.5 h-12"}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={weeks} margin={{ top: 14, right: 2, bottom: 0, left: 2 }}>
          <XAxis
            dataKey="label"
            hide={!showAxis}
            tick={{ fill: colors.tick, fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
            interval={1}
          />
          <YAxis hide domain={[0, Math.max(max, 0.5)]} />
          <Tooltip
            cursor={{ fill: colors.surface2 }}
            content={({ active, payload }) => {
              const w = payload?.[0]?.payload as Week | undefined;
              return (
                <TooltipCard
                  active={active && !!w}
                  value={w ? w[type] : undefined}
                  suffix={w && w[type] === 1 ? "page" : "pages"}
                  detail={ENTRY_META[type].label}
                  label={w?.full}
                />
              );
            }}
          />
          <Bar
            dataKey={type}
            fill={color}
            radius={[4, 4, 0, 0]}
            maxBarSize={20}
            isAnimationActive={false}
          >
            <LabelList
              dataKey={type}
              position="top"
              offset={4}
              fontSize={10}
              fill={colors.tick}
              // Only the tallest week gets a number (ties all do).
              formatter={(v: unknown) => (max > 0 && Number(v) === max ? String(v) : "")}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
