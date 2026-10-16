import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { EmptyNote, SectionCard } from "@/components/stats/SectionCard";
import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dayLabel } from "@/lib/dates";

// Monday-first, matching the Mon–Sun heatmap rows.
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const COLS = 7;
const GAP = 6;

export type HeatCell = { date: string; count: number; op: number } | null;

/**
 * Entries per day over the last 5 calendar weeks (web: the heatmap Card in
 * StatsClient.tsx). The web showed the day's tooltip on hover and pinned it
 * on click; there is no hover here, so a tap pins it and a second tap (or a
 * tap on another cell) moves or clears it.
 *
 * Cells are laid out as five flex rows so no measurement is needed to draw
 * them; the grid width is measured only to place the tooltip, which the web
 * positioned with CSS (bottom-full, centred, clamped by the card).
 */
export function Heatmap({ grid, totalEntries }: { grid: HeatCell[]; totalEntries: number }) {
  const c = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState({ w: 0, h: 0 });

  const onGridLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const onTipLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w !== tip.w || h !== tip.h) setTip({ w, h });
  };

  const rows: HeatCell[][] = [];
  for (let i = 0; i < grid.length; i += COLS) rows.push(grid.slice(i, i + COLS));

  const activeCell = active != null ? grid[active] : null;
  // Placed only once both the grid and the tooltip have been measured; until
  // then it renders hidden (tipHidden) so it never flashes at a guessed spot.
  let tipStyle: { left: number; top: number } | null = null;
  if (active != null && activeCell && width > 0 && tip.w > 0) {
    const cell = (width - GAP * (COLS - 1)) / COLS;
    const col = active % COLS;
    const row = Math.floor(active / COLS);
    const cx = col * (cell + GAP) + cell / 2;
    // Centred over the cell, clamped so it never leaves the card.
    const left = Math.min(Math.max(0, cx - tip.w / 2), Math.max(0, width - tip.w));
    tipStyle = { left, top: row * (cell + GAP) - tip.h - GAP };
  }

  return (
    <SectionCard title="Entries · last 5 weeks (Mon–Sun)">
      {totalEntries === 0 ? (
        <EmptyNote>No entries in this view yet.</EmptyNote>
      ) : (
        <>
          <View style={styles.weekdays}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={[Type.caption, styles.weekday, { color: c.faint }]}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.grid} onLayout={onGridLayout}>
            {rows.map((cells, r) => (
              <View key={r} style={styles.row}>
                {cells.map((cell, k) => {
                  const i = r * COLS + k;
                  if (cell === null) return <View key={i} style={styles.cell} />;
                  return (
                    <Pressable
                      key={i}
                      accessibilityRole="button"
                      accessibilityLabel={`${cell.count} ${cell.count === 1 ? "entry" : "entries"}, ${dayLabel(cell.date)}`}
                      onPress={() => {
                        setActive((v) => (v === i ? null : i));
                        // Each cell's text differs in width: drop the old size
                        // so the remounted tooltip is measured before it shows.
                        setTip({ w: 0, h: 0 });
                      }}
                      style={[
                        styles.cell,
                        cell.op === 0
                          ? { backgroundColor: c.surface2 }
                          : { backgroundColor: c.accent, opacity: cell.op },
                      ]}
                    />
                  );
                })}
              </View>
            ))}
            {activeCell && (
              <View
                // Remount per cell so onLayout always reports the new size.
                key={active}
                pointerEvents="none"
                onLayout={onTipLayout}
                style={[
                  styles.tip,
                  { backgroundColor: c.surface, borderColor: c.border },
                  Elevation.e2,
                  tipStyle ?? styles.tipHidden,
                ]}
              >
                <Text style={[Type.caption, { color: c.foreground }]} numberOfLines={1}>
                  <Text style={styles.tipCount}>{activeCell.count}</Text>{" "}
                  {activeCell.count === 1 ? "entry" : "entries"}
                  <Text style={{ color: c.faint }}> · {dayLabel(activeCell.date)}</Text>
                </Text>
              </View>
            )}
          </View>
        </>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  weekdays: { flexDirection: "row", gap: GAP, marginBottom: 8 },
  weekday: { flex: 1, textAlign: "center" },
  grid: { gap: GAP },
  row: { flexDirection: "row", gap: GAP },
  cell: { flex: 1, aspectRatio: 1, borderRadius: 6 },
  tip: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    zIndex: 30,
  },
  // Until the grid and the tooltip have reported their sizes there is
  // nowhere to put it.
  tipHidden: { opacity: 0, left: 0, top: 0 },
  tipCount: { fontWeight: "600", fontVariant: ["tabular-nums"] },
});
