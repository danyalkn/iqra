/**
 * "Where you are" - your place in the Quran and how it has moved, month by
 * month. Ported 1:1 from reference/web-pwa/app/(app)/stats/ProgressCard.tsx.
 * Memorizers see their latest sabak, the juz it's in, and their new
 * memorization over time; readers see their bookmark over time.
 *
 * Native differences (charts only; the numbers and copy are the web's):
 *   - The time axis is a real numeric axis (x = day stamp) with the web's
 *     `timeTicks` as tickValues and its format as the label formatter.
 *   - A chart shows one Y axis at a time: ReadingView swaps between the
 *     Juz-tick axis (bookmark current) and a 0-to-auto integer axis (stale),
 *     exactly as the web rendered one <YAxis> or the other.
 *   - victory-native nice()s every y domain, so the Juz axis runs [0, 650]
 *     for the 604-page mushaf instead of the web's [1, 604]; the ticks and
 *     the line land in the same places, the top has a little headroom.
 *   - The "1 khatmah" reference line extends the y domain to include it.
 *     recharts' ReferenceLine default (`ifOverflow="discard"`) silently hid
 *     it until the cumulative total passed the nice domain top, which made
 *     the web's 60% threshold a no-op; the threshold is honoured here.
 *   - Dots and the active dot are Skia Scatter / Circle; the tooltip is an
 *     RN overlay driven by the press state.
 */
import { Line as SkiaLine, Text as SkiaText, vec } from "@shopify/react-native-skia";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CartesianChart, Line, Scatter } from "victory-native";

import { Card, SegmentedControl, type Segment } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dayLabel, lastNDaysEndingOn, localDate, monthKey, monthLabel } from "@/lib/dates";
import { juzForPage, juzStartPages, surahForPage, type MushafId } from "@/lib/mushaf";
import { juzLength, pagesPhrase, positionLabel, rowJuzPage } from "@/lib/position";
import {
  dayStamp,
  hifzProgress,
  monthSpans,
  readingProgress,
  timeTicks,
  type HifzProgress,
  type JuzCoverage,
  type ProgressRow,
  type ReadingProgress,
} from "@/lib/progress";

import {
  CHART_PRESS_CONFIG,
  ChartTooltip,
  integerTicks,
  PressCursorLine,
  PressDot,
  useChartColors,
  useChartFont,
  useChartPress,
  useLayoutWidth,
} from "./chartKit";
import type { ProgressCardProps } from "./types";

type ViewMode = "hifz" | "reading";

const fmt = (n: number) => String(+n.toFixed(2));

const SEGMENTS: Segment<ViewMode>[] = [
  { value: "hifz", label: "Memorizing" },
  { value: "reading", label: "Reading" },
];

export function ProgressCard({ mode, tz, today, mushaf, rows }: ProgressCardProps) {
  const c = useTheme();
  const reading = useMemo(() => readingProgress(rows, tz), [rows, tz]);
  const hifz = useMemo(() => hifzProgress(rows, tz, mushaf), [rows, tz, mushaf]);
  // The web seeded its state from `mode` once on mount, after the data had
  // loaded. Native may mount before the rows arrive, so the default is
  // derived until the member taps the toggle.
  const [choice, setChoice] = useState<ViewMode | null>(null);
  const view: ViewMode = choice ?? (mode === "hifz" && hifz ? "hifz" : "reading");

  const both = !!reading && !!hifz;
  const active: ViewMode = both ? view : hifz ? "hifz" : "reading";

  return (
    <Card>
      <View style={styles.header}>
        <Text
          numberOfLines={1}
          style={[Type.callout, styles.semibold, styles.title, { color: c.foreground }]}
        >
          Where you are
        </Text>
        {both && (
          <SegmentedControl
            size="sm"
            segments={SEGMENTS}
            value={view}
            onChange={setChoice}
            style={styles.toggle}
          />
        )}
      </View>

      {active === "hifz" && hifz ? (
        <HifzView hifz={hifz} mushaf={mushaf} today={today} />
      ) : active === "reading" && reading ? (
        <ReadingView rows={rows} reading={reading} tz={tz} today={today} />
      ) : (
        <Text style={[Type.footnote, { color: c.muted }]}>
          {mode === "hifz"
            ? "Log a sabak and set where it starts, and your place in each juz shows up here."
            : "Log a reading with the last page you reached, and your place in the Quran shows up here, month by month."}
        </Text>
      )}
    </Card>
  );
}

// ── Memorizing ──────────────────────────────────────────────────────────────

function HifzView({
  hifz,
  mushaf,
  today,
}: {
  hifz: HifzProgress;
  mushaf: MushafId;
  today: string;
}) {
  const c = useTheme();
  const colors = useChartColors();
  const font = useChartFont(10);
  const { state, isActive, point } = useChartPress("total");
  const [width, onLayout] = useLayoutWidth();

  const latest = hifz.latest;
  // hifzProgress only keeps sabak rows with a juz, so this is never 0.
  const juz = latest.juz ?? 0;
  const start = rowJuzPage(latest);
  const cov = hifz.coverage.get(juz);
  const juzCount = hifz.coverage.size;
  const months = useMemo(() => monthSpans(hifz.trail, (p) => p.total).slice(0, 3), [hifz]);

  const first = hifz.trail[0].t;
  const end = Math.max(hifz.trail[hifz.trail.length - 1].t, dayStamp(today));
  const xTicks = useMemo(() => timeTicks(first, end), [first, end]);
  const data = useMemo(() => {
    const d = hifz.trail.map((p) => ({ date: p.date, t: p.t, total: p.total }));
    // Carry the total to today so the line reads "still here", not "stopped".
    if (d[d.length - 1].t < end) d.push({ date: today, t: end, total: d[d.length - 1].total });
    return d;
  }, [hifz, end, today]);
  const yTicks = useMemo(() => integerTicks(hifz.totalPages, 4), [hifz.totalPages]);
  const pressed = point ? data[point.index] : undefined;

  if (!cov) return null;

  return (
    <>
      <View style={styles.headline}>
        <Text style={[Type.display, { color: c.foreground }]}>Juz {juz}</Text>
        <Text style={[Type.callout, { color: c.muted }]}>
          {start != null ? positionLabel(start, latest.amount) : "latest sabak"}
        </Text>
      </View>
      <Text style={[Type.footnote, styles.mt05, { color: c.muted }]}>
        {fmt(cov.covered)} of {cov.length} pages of Juz {juz} logged as sabak
        {cov.unplaced > 0 && cov.quarters.size > 0
          ? ` (${fmt(cov.unplaced)} without a set start)`
          : ""}
      </Text>

      <JuzPageGrid cov={cov} />
      {cov.quarters.size === 0 && (
        <Text style={[Type.caption, styles.mt15, { color: c.faint }]}>
          Set “Starts at” when you log a sabak and these squares fill in page by page, top
          half and bottom half.
        </Text>
      )}

      {juzCount > 1 && <JuzMap coverage={hifz.coverage} mushaf={mushaf} />}

      <Text style={[Type.footnote, styles.medium, styles.mt4, { color: c.muted }]}>
        New memorization, all time
      </Text>
      <Text style={[Type.caption, { color: c.faint }]}>
        {pagesPhrase(hifz.totalPages)} of sabak across {juzCount} juz
      </Text>
      <View style={[styles.chart, { height: 160 }]} onLayout={onLayout}>
        <CartesianChart
          data={data}
          xKey="t"
          yKeys={["total"]}
          padding={{ top: 8, right: 8, bottom: 0, left: 0 }}
          domain={{ x: [first, end], y: [0, yTicks[yTicks.length - 1]] }}
          xAxis={{
            font,
            tickValues: xTicks.ticks,
            tickCount: xTicks.ticks.length,
            formatXLabel: xTicks.format,
            labelColor: colors.tick,
            labelOffset: 4,
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
            },
          ]}
          frame={{ lineWidth: 0 }}
          chartPressState={state}
          chartPressConfig={CHART_PRESS_CONFIG}
          // Dots live outside the clip so the trailing "today" point and a
          // point on the top grid line keep their full circle (the web's
          // SVG let them overflow the plot area).
          renderOutside={({ points }) => (
            <>
              {data.length < 3 && (
                <>
                  <Scatter points={points.total} radius={4} color={colors.accent} style="fill" />
                  <Scatter
                    points={points.total}
                    radius={4}
                    color={colors.surface}
                    style="stroke"
                    strokeWidth={2}
                  />
                </>
              )}
              {isActive && (
                <PressDot
                  x={state.x.position}
                  y={state.y.total.position}
                  color={colors.accent}
                  ring={colors.surface}
                />
              )}
            </>
          )}
        >
          {({ points, chartBounds }) => (
            <>
              {isActive && (
                <PressCursorLine
                  x={state.x.position}
                  top={chartBounds.top}
                  bottom={chartBounds.bottom}
                  color={colors.grid}
                />
              )}
              <Line
                points={points.total}
                curveType="stepAfter"
                color={colors.accent}
                strokeWidth={2}
              />
            </>
          )}
        </CartesianChart>
        {pressed && point ? (
          <ChartTooltip
            dot
            point={point}
            width={width}
            value={fmt(pressed.total)}
            suffix="pages"
            label={dayLabel(pressed.date)}
          />
        ) : null}
      </View>

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
  const c = useTheme();
  const pages = Array.from({ length: cov.length }, (_, i) => i + 1);
  const halfStyle = (h: number) => {
    const n = (cov.quarters.has(h) ? 1 : 0) + (cov.quarters.has(h + 0.25) ? 1 : 0);
    return n === 2
      ? { backgroundColor: c.accent }
      : n === 1
        ? { backgroundColor: c.accent, opacity: 0.45 }
        : { backgroundColor: c.surface2 };
  };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${fmt(cov.quarters.size / 4)} of ${cov.length} pages placed in Juz ${cov.juz}`}
      style={styles.pageGrid}
    >
      {pages.map((p) => (
        <View key={p} style={styles.pageCol}>
          {[p, p + 0.5].map((h) => (
            <View key={h} style={[styles.halfCell, halfStyle(h)]} />
          ))}
        </View>
      ))}
    </View>
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
  const c = useTheme();
  return (
    <View style={styles.mt4}>
      <Text style={[Type.footnote, styles.medium, { color: c.muted }]}>Sabak by juz</Text>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Sabak logged in ${coverage.size} juz`}
        style={styles.strip}
      >
        {Array.from({ length: 30 }, (_, i) => {
          const cv = coverage.get(i + 1);
          const frac = cv ? cv.covered / juzLength(mushaf, i + 1) : 0;
          return (
            <View key={i} style={[styles.stripCell, { backgroundColor: c.surface2 }]}>
              {frac > 0 && (
                <View
                  style={[
                    styles.stripFill,
                    { backgroundColor: c.accent, height: `${Math.max(15, frac * 100)}%` },
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.stripLabels}>
        <Text style={[Type.caption, { color: c.faint }]}>Juz 1</Text>
        <Text style={[Type.caption, { color: c.faint }]}>Juz 30</Text>
      </View>
    </View>
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
  reading: ReadingProgress;
  tz: string;
  today: string;
}) {
  const c = useTheme();
  const colors = useChartColors();
  const font = useChartFont(10);
  const { state, isActive, point } = useChartPress("v");
  const [width, onLayout] = useLayoutWidth();

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
        (s, r) =>
          days.has(localDate(r.logged_at, tz)) ? s + (r.pages_equiv ? +r.pages_equiv : 0) : s,
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
  const data = useMemo(() => {
    const d = current
      ? reading.trail.map((p) => ({ date: p.date, t: p.t, v: p.page }))
      : cumulative.map((p) => ({ date: p.date, t: p.t, v: p.total }));
    if (d[d.length - 1].t < end) d.push({ date: today, t: end, v: d[d.length - 1].v });
    return d;
  }, [current, reading.trail, cumulative, end, today]);
  const juzTicks = useMemo(
    () => [1, 10, 20, 30].map((j) => juzStartPages(mushaf)[j - 1]),
    [mushaf],
  );
  const xTicks = useMemo(() => timeTicks(first, end), [first, end]);
  const maxCum = cumulative.length ? cumulative[cumulative.length - 1].total : 0;
  const showKhatmahLine = !current && maxCum >= total * 0.6;
  // Stale: integer ticks past the total read, stretched to the 604 line
  // when that line is shown so it lands inside the chart.
  const cumTicks = useMemo(
    () => integerTicks(Math.max(maxCum, showKhatmahLine ? total : 0), 4),
    [maxCum, showKhatmahLine, total],
  );
  const yTicks = current ? juzTicks : cumTicks;
  const yDomain: [number, number] = current ? [1, total] : [0, cumTicks[cumTicks.length - 1]];

  const months = current
    ? readingMonths(reading.trail, total).slice(0, 3)
    : monthSpans(cumulative, (p) => p.total)
        .slice(0, 3)
        .map((m) => ({
          month: m.month,
          text: `+${+(m.to - (m.before ?? 0)).toFixed(1)} pages`,
        }));

  const pressed = point ? data[point.index] : undefined;

  return (
    <>
      <View style={styles.headline}>
        <Text style={[Type.display, { color: c.foreground }]}>Juz {juz}</Text>
        <Text style={[Type.callout, { color: c.muted }]}>{surah.name}</Text>
        <Text style={[Type.callout, styles.rtl, { color: c.faint }]}>{surah.arabic}</Text>
      </View>
      <Text style={[Type.footnote, styles.mt05, { color: c.muted }]}>
        Page {page} of {total} · {Math.round((page / total) * 100)}% of the way through
        {khatms > 0 ? ` · khatm #${khatms + 1}` : ""}
      </Text>
      <View style={[styles.track, { backgroundColor: c.surface2 }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: c.accent, width: `${Math.min(100, (page / total) * 100)}%` },
          ]}
        />
      </View>
      {current ? (
        etaDays != null && (
          <Text style={[Type.footnote, styles.mt15, { color: c.faint }]}>
            About {etaDays} {etaDays === 1 ? "day" : "days"} to finish at your pace
          </Text>
        )
      ) : (
        <Text style={[Type.footnote, styles.warnNote, { backgroundColor: c.warnTint, color: c.warn }]}>
          Your recent readings didn’t set a last page, so this bookmark may be behind. Leave
          “Continue from last page” on when you log to keep it current.
        </Text>
      )}

      <Text style={[Type.footnote, styles.medium, styles.mt4, { color: c.muted }]}>
        {current ? "Your place, month by month" : "Pages read, all time"}
      </Text>
      <View style={[styles.chart, { height: 176 }]} onLayout={onLayout}>
        <CartesianChart
          data={data}
          xKey="t"
          yKeys={["v"]}
          padding={{ top: 8, right: 8, bottom: 0, left: 0 }}
          domain={{ x: [first, end], y: yDomain }}
          xAxis={{
            font,
            tickValues: xTicks.ticks,
            tickCount: xTicks.ticks.length,
            formatXLabel: xTicks.format,
            labelColor: colors.tick,
            labelOffset: 4,
            lineWidth: 0,
          }}
          yAxis={[
            {
              font,
              tickValues: yTicks,
              tickCount: yTicks.length,
              formatYLabel: current
                ? (p) => `Juz ${juzForPage(mushaf, p)}`
                : (v) => String(v),
              labelColor: colors.tick,
              labelOffset: 6,
              lineColor: colors.grid,
              lineWidth: 1,
            },
          ]}
          frame={{ lineWidth: 0 }}
          chartPressState={state}
          chartPressConfig={CHART_PRESS_CONFIG}
          // Outside the clip: the "1 khatmah" label (its glyphs rise above
          // the line), the dots and the active dot at the chart edges.
          renderOutside={({ points, chartBounds, yScale }) => (
            <>
              {showKhatmahLine && (
                <>
                  <SkiaLine
                    p1={vec(chartBounds.left, yScale(total))}
                    p2={vec(chartBounds.right, yScale(total))}
                    color={colors.tick}
                    strokeWidth={1}
                  />
                  <SkiaText
                    x={chartBounds.left + 4}
                    y={yScale(total) - 4}
                    text="1 khatmah"
                    font={font}
                    color={colors.tick}
                  />
                </>
              )}
              {data.length < 3 && (
                <>
                  <Scatter points={points.v} radius={4} color={colors.accent} style="fill" />
                  <Scatter
                    points={points.v}
                    radius={4}
                    color={colors.surface}
                    style="stroke"
                    strokeWidth={2}
                  />
                </>
              )}
              {isActive && (
                <PressDot
                  x={state.x.position}
                  y={state.y.v.position}
                  color={colors.accent}
                  ring={colors.surface}
                />
              )}
            </>
          )}
        >
          {({ points, chartBounds }) => (
            <>
              {isActive && (
                <PressCursorLine
                  x={state.x.position}
                  top={chartBounds.top}
                  bottom={chartBounds.bottom}
                  color={colors.grid}
                />
              )}
              <Line points={points.v} curveType="linear" color={colors.accent} strokeWidth={2} />
            </>
          )}
        </CartesianChart>
        {pressed && point ? (
          current ? (
            <ChartTooltip
              dot
              point={point}
              width={width}
              value={`p.${pressed.v}`}
              detail={`Juz ${juzForPage(mushaf, pressed.v)} · ${surahForPage(mushaf, pressed.v).name}`}
              label={dayLabel(pressed.date)}
            />
          ) : (
            <ChartTooltip
              dot
              point={point}
              width={width}
              value={pressed.v}
              suffix="pages read"
              label={dayLabel(pressed.date)}
            />
          )
        ) : null}
      </View>

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
  const months: {
    month: string;
    start: number | null;
    first: number;
    to: number;
    wraps: number;
  }[] = [];
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
function MonthList({ today, rows }: { today: string; rows: { month: string; text: string }[] }) {
  const c = useTheme();
  if (rows.length === 0) return null;
  return (
    <View style={[styles.monthList, { borderTopColor: c.border }]}>
      {rows.map((r, i) => (
        <View
          key={r.month}
          style={[styles.monthRow, i > 0 && [styles.hairlineTop, { borderTopColor: c.border }]]}
        >
          <Text style={[Type.footnote, { color: c.muted }]}>{monthLabel(r.month, today)}</Text>
          <Text style={[Type.footnote, styles.medium, { color: c.foreground }]}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  // The title gives way first (one line, ellipsised) so the control keeps
  // its full width. The segments split the track with flex 1 from a zero
  // basis, so without a width the track sizes to nothing useful and the
  // row cut "Reading" off at the card edge; 190 holds both 14pt labels.
  title: { flexShrink: 1 },
  toggle: { flexShrink: 0, width: 190 },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  mt05: { marginTop: 2 },
  mt15: { marginTop: 6 },
  mt4: { marginTop: 16 },
  rtl: { writingDirection: "rtl" },
  headline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 8,
    rowGap: 2,
  },
  chart: { marginTop: 8, position: "relative" },
  // JuzPageGrid: one column per page, two 10px half cells, 2px gaps.
  pageGrid: { flexDirection: "row", gap: 2, marginTop: 12 },
  pageCol: { flex: 1, gap: 2 },
  halfCell: { height: 10, borderRadius: 2 },
  // JuzMap: 30 cells, filled from the bottom.
  strip: { flexDirection: "row", gap: 2, marginTop: 6 },
  stripCell: { flex: 1, height: 14, borderRadius: 3, overflow: "hidden" },
  stripFill: { position: "absolute", left: 0, right: 0, bottom: 0 },
  stripLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  // Reading progress bar (web: h-2 rounded-full).
  track: { height: 8, borderRadius: 999, overflow: "hidden", marginTop: 12 },
  fill: { height: "100%", borderRadius: 999 },
  warnNote: {
    marginTop: 8,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  monthList: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  monthRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
  },
  hairlineTop: { borderTopWidth: StyleSheet.hairlineWidth },
});
