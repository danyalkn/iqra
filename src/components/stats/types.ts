/**
 * Contracts between the two halves of the Insights (Stats) port.
 *
 *   Chart side (chartKit.tsx, PagesBarChart.tsx, ProgressCard.tsx,
 *   KhatmahCard.tsx, HifzBreakdownCard.tsx): everything that touches
 *   victory-native / Skia.
 *
 *   Screen side (src/app/(tabs)/stats.tsx and the non-chart cards): loads
 *   the data, derives every number the web StatsClient derived, and places
 *   the chart-side components. It never imports victory-native or Skia.
 *
 * Both halves import these types; neither edits this file without the other.
 */
import type { Mode } from "@/lib/entries";
import type { KhatmahRow } from "@/lib/khatmah";
import type { MushafId } from "@/lib/mushaf";
import type { ProgressRow } from "@/lib/progress";
import type { LogRow } from "@/lib/types";

/** Resolved design tokens for the charts (the web read CSS variables; here
 *  they come straight from the theme). chart1..3 are the ordinal green ramp
 *  for Sabak -> Sabak Para -> Dhor: in light mode chart1 is darkest, in dark
 *  mode lightest, so Sabak always carries the most emphasis. */
export type ChartColors = {
  accent: string;
  grid: string;
  tick: string;
  surface: string;
  surface2: string;
  chart1: string;
  chart2: string;
  chart3: string;
};

/** One bar of the month browser or the weekly trend. `label` is the short
 *  x-axis text, `full` the tooltip label ("7 Jul to 13 Jul · so far"). */
export type BarDatum = { label: string; full: string; pages: number };

/**
 * A vertical pages bar chart with the web look: dashed or solid horizontal
 * grid, no axis lines, faint tick labels, accent bars with rounded tops,
 * and a press tooltip (value first, then the full label). Animation off.
 */
export type PagesBarChartProps = {
  data: BarDatum[];
  /** Chart height in points (web: h-40 = 160 for the month, 150 weekly). */
  height: number;
  /** Show every nth x label, counting from the first: 1 = every bar, 2 =
   *  every other (web `interval={1}`), 3 = every third (`interval={2}`),
   *  5 = every fifth (`interval={4}`). */
  labelEvery: number;
  /** Cap on the bar width (web maxBarSize). */
  maxBarWidth: number;
  /** Dashed grid lines (the month browser) or solid (weekly). */
  dashedGrid?: boolean;
  /** Tooltip unit after the value. */
  suffix?: string;
  /** A dashed reference line at this value (the reading card's juz a
   *  week). The y axis grows past it so the line never sits on the top. */
  goal?: number;
};

export type ProgressCardProps = {
  mode: Mode;
  tz: string;
  today: string;
  mushaf: MushafId;
  /** The signed-in user's entries, all time. */
  rows: ProgressRow[];
};

export type KhatmahCardProps = {
  rows: KhatmahRow[];
  tz: string;
  today: string;
};

export type HifzBreakdownCardProps = {
  /** The signed-in user's entries, all time. */
  rows: LogRow[];
  tz: string;
  today: string;
};
