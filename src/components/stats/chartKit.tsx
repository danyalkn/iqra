/**
 * Shared chart plumbing for the Insights tab, ported from
 * reference/web-pwa/app/(app)/stats/chartKit.tsx.
 *
 * The web read its chart colours out of CSS variables (recharts paints SVG
 * attributes that cannot read them) and re-read them on every scheme flip.
 * Here the colours come straight from the theme object on each render, so a
 * flip repaints every chart without an observer. The tooltip keeps the web's
 * one style (value first, then an optional detail, then the label) but is a
 * React Native overlay driven by victory-native's press state: Skia text
 * cannot be laid out like a card, and an overlay gets the real type ramp.
 *
 * Every chart uses the same three pieces:
 *   - `useChartPress(key)` wraps victory's press state and lifts the matched
 *     point into React state (only while a finger is down);
 *   - a Skia cursor (`PressCursorLine` / `PressCursorBand`) and `PressDot`
 *     read the shared values on the UI thread, no re-render per move;
 *   - `<ChartTooltip point width ... />` sits in the same relative View as
 *     the chart, above the point, clamped to the chart width.
 */
import {
  Circle,
  Line as SkiaLine,
  Rect as SkiaRect,
  matchFont,
  type SkFont,
} from "@shopify/react-native-skia";
import { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useAnimatedReaction, useDerivedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useChartPressState, type ChartPressState } from "victory-native";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

import type { ChartColors } from "./types";

// ── Colours ─────────────────────────────────────────────────────────────────

/** The web's `--accent`, `--border`, `--faint`, `--surface`, `--surface-2`
 *  and `--chart-1..3` mapping, resolved from the theme. Memoised on the theme
 *  object so chart props keep their identity between renders of one scheme. */
export function useChartColors(): ChartColors {
  const c = useTheme();
  return useMemo(
    () => ({
      accent: c.accent,
      grid: c.border,
      tick: c.faint,
      surface: c.surface,
      surface2: c.surface2,
      chart1: c.chart1,
      chart2: c.chart2,
      chart3: c.chart3,
    }),
    [c],
  );
}

// ── Font ────────────────────────────────────────────────────────────────────

/** System family for Skia's font manager. Skia has no "system-ui" alias on
 *  iOS, so Helvetica (always installed) stands in for San Francisco at axis
 *  sizes; Android's "sans-serif" resolves to Roboto. No .ttf to bundle. */
const CHART_FONT_FAMILY = Platform.select({ ios: "Helvetica", default: "sans-serif" });

/** One SkFont per size for the whole app: matchFont allocates a native
 *  typeface, and every chart on the Stats tab asks for the same 10px. */
const fontCache = new Map<number, SkFont | null>();

/** Axis and bar-label font. Null when the system font manager cannot match
 *  anything: victory-native then skips the labels and draws the rest. */
export function useChartFont(size = 10): SkFont | null {
  return useMemo(() => {
    const cached = fontCache.get(size);
    if (cached !== undefined) return cached;
    let font: SkFont | null = null;
    try {
      font = matchFont({ fontFamily: CHART_FONT_FAMILY, fontSize: size, fontWeight: "normal" });
    } catch {
      font = null;
    }
    fontCache.set(size, font);
    return font;
  }, [size]);
}

// ── Ticks ───────────────────────────────────────────────────────────────────

/**
 * Integer y ticks from 0 past `max`, about `count` of them, stepping by
 * 1 / 2 / 5 x 10^n: what recharts picked for `allowDecimals={false}`. The
 * last tick is meant as the domain top, so every grid line carries a label
 * (victory-native draws a line per tick, labelled or not). The top is a
 * multiple of its step, which keeps d3's nice() from moving it in all but a
 * few cases (15, 25, 75 ...), where the domain grows by one minor step.
 */
export function integerTicks(max: number, count = 4): number[] {
  const top = Math.max(1, Math.ceil(max));
  const raw = top / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow,
  );
  const ticks: number[] = [];
  for (let v = 0; v < top + step; v += step) ticks.push(v);
  return ticks;
}

// ── Press state ─────────────────────────────────────────────────────────────

/** The matched datum and its canvas position, in the chart View's frame. */
export type PressPoint = { index: number; x: number; y: number };

export type ChartPress<K extends string> = {
  /** Hand this to `<CartesianChart chartPressState>`. */
  state: ChartPressState<{ x: number; y: Record<K, number> }>;
  /** A finger is down on the chart (React state, from victory). */
  isActive: boolean;
  /** The datum under the finger, or null. Changes only when the matched
   *  index changes, so the tooltip re-renders per bar, not per pixel. */
  point: PressPoint | null;
};

/**
 * victory-native's press state plus the matched point lifted into React.
 * The reaction runs on the UI thread and hops to JS with scheduleOnRN only
 * when the index changes or the press ends; everything that should track
 * the finger continuously (cursor, dot) reads `state` directly.
 */
export function useChartPress<K extends string>(key: K): ChartPress<K> {
  const init = useMemo(() => ({ x: 0, y: { [key]: 0 } as Record<K, number> }), [key]);
  const { state, isActive } = useChartPressState(init);
  const [point, setPoint] = useState<PressPoint | null>(null);
  const yPosition = state.y[key].position;

  useAnimatedReaction(
    () => ({
      active: state.isActive.get(),
      index: state.matchedIndex.get(),
      x: state.x.position.get(),
      y: yPosition.get(),
    }),
    (cur, prev) => {
      if (!cur.active || cur.index < 0) {
        if (prev?.active) scheduleOnRN(setPoint, null);
        return;
      }
      if (!prev?.active || prev.index !== cur.index) {
        scheduleOnRN(setPoint, { index: cur.index, x: cur.x, y: cur.y });
      }
    },
  );

  return { state, isActive, point };
}

/** Width of the chart's wrapper View, for clamping the tooltip. */
export function useLayoutWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);
  return [width, onLayout];
}

// ── Skia cursor pieces (render inside the CartesianChart children) ──────────

/** Vertical line at the pressed x: the web's `cursor={{ stroke }}` on the
 *  line charts. The points are derived on the UI thread. */
export function PressCursorLine({
  x,
  top,
  bottom,
  color,
}: {
  x: SharedValue<number>;
  top: number;
  bottom: number;
  color: string;
}) {
  const p1 = useDerivedValue(() => ({ x: x.get(), y: top }));
  const p2 = useDerivedValue(() => ({ x: x.get(), y: bottom }));
  return <SkiaLine p1={p1} p2={p2} color={color} strokeWidth={1} />;
}

/** Soft band behind the pressed bar: the web's `cursor={{ fill }}` on the
 *  bar charts. Draw it before the bars so it sits underneath. */
export function PressCursorBand({
  x,
  width,
  top,
  bottom,
  color,
}: {
  x: SharedValue<number>;
  width: number;
  top: number;
  bottom: number;
  color: string;
}) {
  const left = useDerivedValue(() => x.get() - width / 2);
  return <SkiaRect x={left} y={top} width={width} height={bottom - top} color={color} />;
}

/** The web's activeDot: a 4px accent dot with a 2px surface ring. */
export function PressDot({
  x,
  y,
  color,
  ring,
}: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  color: string;
  ring: string;
}) {
  return (
    <>
      <Circle cx={x} cy={y} r={4} color={color} />
      <Circle cx={x} cy={y} r={4} color={ring} style="stroke" strokeWidth={2} />
    </>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

/**
 * The one tooltip style every chart on the page uses: value first. Ported
 * from the web's TooltipCard (rounded-xl border bg-surface px-3 py-2
 * shadow-e2). Absolutely positioned inside the chart's wrapper View, 8px
 * above the point, clamped so it never leaves the chart's width; it measures
 * itself once and stays invisible until it has.
 */
export function ChartTooltip({
  point,
  width,
  value,
  suffix,
  detail,
  label,
}: {
  point: PressPoint | null;
  /** Width of the wrapper View (from `useLayoutWidth`). */
  width: number;
  value: number | string;
  suffix?: string;
  /** Optional second line under the value. */
  detail?: string;
  label: string;
}) {
  const c = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  if (!point) return null;

  const left = Math.min(Math.max(point.x - size.w / 2, 0), Math.max(0, width - size.w));
  const top = Math.max(0, point.y - size.h - 8);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== size.w || h !== size.h) setSize({ w, h });
  };

  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={[
        styles.tooltip,
        Elevation.e2,
        {
          left,
          top,
          maxWidth: Math.max(0, width),
          opacity: size.w > 0 ? 1 : 0,
          backgroundColor: c.surface,
          borderColor: c.border,
        },
      ]}
    >
      <Text style={[Type.subhead, styles.value, { color: c.foreground }]}>
        {value}
        {suffix ? ` ${suffix}` : ""}
      </Text>
      {detail ? <Text style={[Type.caption, { color: c.muted }]}>{detail}</Text> : null}
      <Text style={[Type.caption, { color: c.faint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tooltip: {
    position: "absolute",
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  value: { fontWeight: "600", fontVariant: ["tabular-nums"] },
});
