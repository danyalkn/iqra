import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PagesBarChart } from "@/components/stats/PagesBarChart";
import type { BarDatum } from "@/components/stats/types";
import { Card } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Page back through any past month (web: the month browser card in
 * StatsClient.tsx). The screen owns the month state and the derived numbers;
 * this card only lays them out and reports the chevron taps.
 */
export function MonthBrowser({
  monthName,
  prevMonthName,
  isThisMonth,
  today,
  canGoBack,
  onPrev,
  onNext,
  group,
  pages,
  prevPages,
  monthActiveDays,
  monthPages,
  monthBar,
}: {
  monthName: string;
  prevMonthName: string;
  isThisMonth: boolean;
  /** Local YYYY-MM-DD; only the day number is read for "1–{d} so far". */
  today: string;
  canGoBack: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Group scope: "pages read together" instead of "pages read". */
  group: boolean;
  /** Pages in the selected month for the current scope. */
  pages: number;
  /** Pages in the month before, same scope. */
  prevPages: number;
  monthActiveDays: number;
  /** Sum of the bars; 0 shows the "Nothing logged" line instead of a chart. */
  monthPages: number;
  monthBar: BarDatum[];
}) {
  const c = useTheme();
  const chevron = (disabled: boolean) => [
    styles.chevron,
    { backgroundColor: c.surface2 },
    disabled && styles.disabled,
  ];
  return (
    <Card>
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          accessibilityState={{ disabled: !canGoBack }}
          disabled={!canGoBack}
          onPress={onPrev}
          hitSlop={4}
          style={chevron(!canGoBack)}
        >
          <ChevronLeft size={20} color={c.muted} />
        </Pressable>
        <View style={styles.monthText}>
          <Text style={[Type.callout, styles.monthName, { color: c.foreground }]} numberOfLines={1}>
            {monthName}
          </Text>
          <Text style={[Type.caption, styles.centered, { color: c.faint }]}>
            {isThisMonth ? `1–${+today.slice(8, 10)} so far` : "full month"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          accessibilityState={{ disabled: isThisMonth }}
          disabled={isThisMonth}
          onPress={onNext}
          hitSlop={4}
          style={chevron(isThisMonth)}
        >
          <ChevronRight size={20} color={c.muted} />
        </Pressable>
      </View>

      <View style={styles.bigRow}>
        <Text style={[Type.display, styles.tabular, { color: c.foreground }]}>{pages}</Text>
        <Text style={[Type.callout, { color: c.muted }]}>
          pages {group ? "read together" : "read"}
        </Text>
        <Text style={[Type.footnote, styles.rest, { color: c.faint }]}>
          ≈ {Math.round(pages / 20)} juz
        </Text>
      </View>
      {/* Name the month in both clauses - the active-day count belongs to
          the selected month, not the comparison month. */}
      <Text style={[Type.footnote, styles.compare, { color: c.faint }]}>
        {monthActiveDays > 0 &&
          `Logged on ${monthActiveDays} ${monthActiveDays === 1 ? "day" : "days"} in ${monthName} · `}
        {prevMonthName} total: {prevPages} pages
      </Text>

      {monthPages === 0 ? (
        <Text style={[Type.footnote, styles.nothing, { color: c.faint }]}>
          Nothing logged in {monthName}.
        </Text>
      ) : (
        <View style={styles.chart}>
          <PagesBarChart
            data={monthBar}
            height={160}
            labelEvery={monthBar.length > 20 ? 5 : 3}
            maxBarWidth={14}
            dashedGrid
            suffix="pages"
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  chevron: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  disabled: { opacity: 0.3 },
  // Full-width lines centred by textAlign, not alignItems: Android can draw
  // a text at its own measured width a hair too narrow and wrap its last
  // word away (RecapCard's "Your week" showed as "Your").
  monthText: { flex: 1, minWidth: 0 },
  monthName: { fontWeight: "600", textAlign: "center" },
  centered: { textAlign: "center" },
  rest: { flexGrow: 1 },
  bigRow: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 8,
    rowGap: 2,
  },
  tabular: { fontVariant: ["tabular-nums"] },
  compare: { marginTop: 2 },
  nothing: { marginTop: 16 },
  chart: { marginTop: 12 },
});
