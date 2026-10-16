/**
 * Vertical pages bars, ported from the two recharts BarCharts in
 * reference/web-pwa/app/(app)/stats/StatsClient.tsx: the month browser
 * (h-40, dashed grid, maxBarSize 14, every 3rd or 5th label) and the weekly
 * trend (150px, solid grid, maxBarSize 26, every other label). The screen
 * side passes those differences as props (see types.ts).
 *
 * Native differences:
 *   - victory-native has no `interval`, so the x axis is the bar index and
 *     `formatXLabel` maps it to the label, returning "" to skip one.
 *   - The y ticks are precomputed integers (`integerTicks`) and the domain
 *     top is the last tick, so every grid line is labelled; recharts did
 *     the same with `allowDecimals={false}`.
 *   - The bar width is derived from the chart bounds inside the render
 *     prop (victory sizes bars from the full axis, which would clip the end
 *     bars without domain padding), capped at `maxBarWidth`.
 *   - The press tooltip is an RN overlay; the band behind the pressed bar
 *     is a Skia rect driven by the press state on the UI thread.
 *   - Animation stays off (the web set isAnimationActive={false}; victory's
 *     animated paths leak, see docs/HANDOFF.md § Charts).
 */
import { DashPathEffect } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { View } from "react-native";
import { Bar, CartesianChart } from "victory-native";

import {
  CHART_PRESS_CONFIG,
  ChartTooltip,
  integerTicks,
  PressCursorBand,
  useChartColors,
  useChartFont,
  useChartPress,
  useLayoutWidth,
} from "./chartKit";
import type { PagesBarChartProps } from "./types";

const fmt = (n: number) => String(+n.toFixed(2));

export function PagesBarChart({
  data,
  height,
  labelEvery,
  maxBarWidth,
  dashedGrid = false,
  suffix,
}: PagesBarChartProps) {
  const colors = useChartColors();
  const font = useChartFont(10);
  const { state, isActive, point } = useChartPress("pages");
  const [width, onLayout] = useLayoutWidth();

  // Index-keyed copy: victory needs a numeric x for a bar per datum and
  // resets the press state whenever `data` changes identity, so memoise.
  const chartData = useMemo(() => data.map((d, i) => ({ i, pages: d.pages })), [data]);
  const xTicks = useMemo(() => data.map((_, i) => i), [data]);
  const max = data.reduce((m, d) => Math.max(m, d.pages), 0);
  // All-zero data still gets a [0, 1] axis instead of a collapsed scale.
  const yTicks = useMemo(() => integerTicks(Math.max(1, max), 4), [max]);
  const top = yTicks[yTicks.length - 1];
  const n = data.length;
  // Room for half a bar (plus a hair) at both ends of the axis.
  const edge = maxBarWidth / 2 + 2;

  const pressed = point ? data[point.index] : undefined;

  return (
    <View style={{ height }} onLayout={onLayout}>
      <CartesianChart
        data={chartData}
        xKey="i"
        yKeys={["pages"]}
        // Top padding keeps the top y label (centred on its grid line) on
        // the canvas; victory drops a label whose baseline is above fontSize.
        padding={{ top: 8, right: 0, bottom: 0, left: 0 }}
        domain={{ y: [0, top] }}
        domainPadding={{ left: edge, right: edge }}
        xAxis={{
          font,
          tickValues: xTicks,
          tickCount: n,
          formatXLabel: (i) => (i % labelEvery === 0 ? (data[i]?.label ?? "") : ""),
          labelColor: colors.tick,
          labelOffset: 4,
          // No vertical grid (web: CartesianGrid vertical={false}).
          lineWidth: 0,
        }}
        yAxis={[
          {
            font,
            tickValues: yTicks,
            tickCount: yTicks.length,
            formatYLabel: (v) => String(v),
            labelColor: colors.tick,
            labelOffset: 6,
            lineColor: colors.grid,
            lineWidth: 1,
            linePathEffect: dashedGrid ? <DashPathEffect intervals={[3, 3]} /> : undefined,
          },
        ]}
        frame={{ lineWidth: 0 }}
        chartPressState={state}
        chartPressConfig={CHART_PRESS_CONFIG}
      >
        {({ points, chartBounds }) => {
          // chartBounds spans the padded axis; the bar centres sit `edge`
          // inside each end, so the centre-to-centre slot excludes them.
          const span = chartBounds.right - chartBounds.left;
          const slot = n > 1 ? (span - 2 * edge) / (n - 1) : span;
          const barWidth = Math.max(2, Math.min(maxBarWidth, slot * 0.7));
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
                color={colors.accent}
                barWidth={barWidth}
                roundedCorners={{ topLeft: 6, topRight: 6 }}
              />
            </>
          );
        }}
      </CartesianChart>
      {pressed && point ? (
        <ChartTooltip
          point={point}
          width={width}
          value={fmt(pressed.pages)}
          suffix={suffix}
          label={pressed.full}
        />
      ) : null}
    </View>
  );
}
