/**
 * Sabak, Sabak Para and Dhor one under the other: pages per calendar week
 * for each type, plus what each one last covered. Ported 1:1 from
 * reference/web-pwa/app/(app)/stats/HifzBreakdownCard.tsx. Small multiples,
 * not a stacked bar: a half page of sabak would vanish stacked under a
 * 20-page dhor, so each type gets its own row and scale (HANDOFF § Charts).
 *
 * Native differences (chart only):
 *   - The x axis is the week index; only the last row has a visible axis
 *     (labels every other week, a bottom frame line in the grid colour,
 *     which is where victory draws an axis baseline).
 *   - The y axis is hidden by giving it no ticks and no line; its domain is
 *     the web's [0, max(max, 0.5)], which victory nice()s slightly upward.
 *   - Room for the tallest bar's label comes from `domainPadding.top`:
 *     victory clips bar labels to the chart bounds, so the web's top margin
 *     alone would hide them.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Bar, CartesianChart } from "victory-native";
import type { SkFont } from "@shopify/react-native-skia";

import { Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  addWeeks,
  localDate,
  shortDate,
  startOfWeek,
  weekDatesUpTo,
  weekRangeLabel,
} from "@/lib/dates";
import { ENTRY_META } from "@/lib/entries";
import { describeEntry } from "@/lib/format";
import type { LogRow } from "@/lib/types";

import {
  CHART_PRESS_CONFIG,
  ChartTooltip,
  PressCursorBand,
  useChartColors,
  useChartFont,
  useChartPress,
  useLayoutWidth,
} from "./chartKit";
import type { ChartColors, HifzBreakdownCardProps } from "./types";

type HifzType = "sabak" | "sabak_para" | "dor";
/** Newest material first: Sabak, then Sabak Para, then Dhor. */
const TYPES: HifzType[] = ["sabak", "sabak_para", "dor"];
const WEEKS = 8;
const WEEK_INDEX = Array.from({ length: WEEKS }, (_, i) => i);

const SHORT_DESC: Record<HifzType, string> = {
  sabak: "New lesson",
  sabak_para: "Recent revision",
  dor: "Old revision",
};

const colorOf = (c: ChartColors, t: HifzType) =>
  t === "sabak" ? c.chart1 : t === "sabak_para" ? c.chart2 : c.chart3;

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

export function HifzBreakdownCard({ rows, tz, today }: HifzBreakdownCardProps) {
  const c = useTheme();
  const colors = useChartColors();
  const font = useChartFont(10);

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
    <Card>
      <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
        Sabak, Sabak Para & Dhor
      </Text>
      <Text style={[Type.caption, { color: c.faint }]}>
        Pages per week, last {WEEKS} weeks · each on its own scale
      </Text>

      {!any && (
        <Text style={[Type.footnote, styles.mt3, { color: c.muted }]}>
          No Sabak, Sabak Para or Dhor logged in the last {WEEKS} weeks.
        </Text>
      )}

      <View style={styles.rows}>
        {TYPES.map((t, i) => {
          const last = latest[t];
          const isLast = i === TYPES.length - 1;
          return (
            <View
              key={t}
              style={[
                i > 0 && [styles.rowDivided, { borderTopColor: c.border }],
                !isLast && styles.rowPadBottom,
              ]}
            >
              <View style={styles.titleRow}>
                <View style={styles.titleLeft}>
                  <View style={[styles.swatch, { backgroundColor: colorOf(colors, t) }]} />
                  <Text
                    numberOfLines={1}
                    style={[Type.subhead, styles.titleText, { color: c.foreground }]}
                  >
                    {ENTRY_META[t].label}{" "}
                    <Text style={[styles.regular, { color: c.faint }]}>· {SHORT_DESC[t]}</Text>
                  </Text>
                </View>
                <Text style={[Type.subhead, styles.total, { color: c.foreground }]}>
                  {totals[t]}
                  <Text style={[styles.regular, { color: c.faint }]}>
                    {" "}
                    {totals[t] === 1 ? "page" : "pages"}
                  </Text>
                </Text>
              </View>
              <Text numberOfLines={1} style={[Type.footnote, styles.last, { color: c.muted }]}>
                {last
                  ? `Last: ${describeEntry(last)} · ${ago(localDate(last.logged_at, tz), today)}`
                  : "Not logged yet"}
              </Text>
              {any && (
                <TypeBars
                  weeks={weeks}
                  type={t}
                  color={colorOf(colors, t)}
                  colors={colors}
                  font={font}
                  showAxis={isLast}
                />
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

/** One type's weekly pages. Only the tallest week is labelled; the tooltip
 *  and the total beside the title carry the rest. */
function TypeBars({
  weeks,
  type,
  color,
  colors,
  font,
  showAxis,
}: {
  weeks: Week[];
  type: HifzType;
  color: string;
  colors: ChartColors;
  font: SkFont | null;
  showAxis: boolean;
}) {
  const { state, isActive, point } = useChartPress("pages");
  const [width, onLayout] = useLayoutWidth();
  const max = weeks.reduce((m, w) => Math.max(m, w[type]), 0);
  const chartData = useMemo(
    () => weeks.map((w, i) => ({ i, pages: w[type] })),
    [weeks, type],
  );
  const pressed = point ? weeks[point.index] : undefined;

  return (
    <View style={[styles.bars, { height: showAxis ? 72 : 48 }]} onLayout={onLayout}>
      <CartesianChart
        data={chartData}
        xKey="i"
        yKeys={["pages"]}
        padding={{ top: 0, right: 2, bottom: 0, left: 2 }}
        domain={{ y: [0, Math.max(max, 0.5)] }}
        // Top: room for the label above the tallest bar (web margin.top 14).
        // Sides: half a bar at each end of the axis.
        domainPadding={{ top: 14, left: 12, right: 12 }}
        xAxis={{
          font: showAxis ? font : null,
          tickValues: WEEK_INDEX,
          tickCount: WEEKS,
          // Web: interval={1}, every other week, only on the last row.
          formatXLabel: (i) => (showAxis && i % 2 === 0 ? (weeks[i]?.label ?? "") : ""),
          labelColor: colors.tick,
          labelOffset: 4,
          lineWidth: 0,
        }}
        yAxis={[{ font: null, tickCount: 0, lineWidth: 0 }]}
        frame={{
          lineWidth: { top: 0, right: 0, bottom: showAxis ? 1 : 0, left: 0 },
          lineColor: colors.grid,
        }}
        chartPressState={state}
        chartPressConfig={CHART_PRESS_CONFIG}
      >
        {({ points, chartBounds }) => {
          // Centre-to-centre distance: chartBounds includes the 12px side
          // padding, the bar centres sit inside it.
          const slot = (chartBounds.right - chartBounds.left - 24) / (WEEKS - 1);
          const barWidth = Math.max(2, Math.min(20, slot * 0.7));
          return (
            <>
              {isActive && (
                <PressCursorBand
                  x={state.x.position}
                  width={Math.min(slot, barWidth + 8)}
                  top={chartBounds.top}
                  bottom={chartBounds.bottom}
                  color={colors.surface2}
                />
              )}
              <Bar
                points={points.pages}
                chartBounds={chartBounds}
                color={color}
                barWidth={barWidth}
                roundedCorners={{ topLeft: 4, topRight: 4 }}
                labels={{
                  position: "top",
                  font,
                  color: colors.tick,
                  // Only the tallest week gets a number (ties all do).
                  formatLabel: (v) => (max > 0 && Number(v) === max ? String(v) : ""),
                }}
              />
            </>
          );
        }}
      </CartesianChart>
      {pressed && point ? (
        <ChartTooltip
          point={point}
          width={width}
          value={pressed[type]}
          suffix={pressed[type] === 1 ? "page" : "pages"}
          detail={ENTRY_META[type].label}
          label={pressed.full}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  semibold: { fontWeight: "600" },
  regular: { fontWeight: "400" },
  mt3: { marginTop: 12 },
  rows: { marginTop: 12 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  rowPadBottom: { paddingBottom: 12 },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  titleLeft: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 },
  swatch: { width: 10, height: 10, borderRadius: 3, flexShrink: 0 },
  titleText: { flexShrink: 1 },
  total: { fontWeight: "600", fontVariant: ["tabular-nums"], flexShrink: 0 },
  // Web: pl-[1.125rem] = swatch 10 + gap 8.
  last: { marginTop: 2, paddingLeft: 18 },
  bars: { marginTop: 6, position: "relative" },
});
