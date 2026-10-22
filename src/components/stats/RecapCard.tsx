import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";

import { Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { PersonalSignals } from "@/lib/insights";

// Monday-first, matching the Mon–Sun heatmap rows.
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export type RecapDay = {
  d: string;
  logged: boolean;
  future: boolean;
  isToday: boolean;
};

export type Recap = {
  monday: string;
  label: string;
  days: RecapDay[];
  activeDays: number;
  movement: { from: number; to: number; surah: string } | null;
};

/**
 * "Your week" (web: the `#recap` card in StatsClient.tsx). The Sunday push
 * deep-links here; the screen captures this card's position through
 * `onLayout` and scrolls to it, which is why the layout callback is a prop.
 *
 * Leads with a typical week: one outstanding week should not make the next
 * one look like a collapse (src/lib/insights.ts, weekBaseline).
 */
export function RecapCard({
  recap,
  signals,
  onLayout,
}: {
  recap: Recap;
  signals: PersonalSignals;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const c = useTheme();
  const pages = signals.pagesThisWeek;
  const baselineLine =
    signals.baseline.weeks >= 3 && signals.baseline.typicalSpan > 0
      ? `Usually ${signals.baseline.typicalSpan} by this point · last week ${signals.pagesSameSpanLastWeek}`
      : `${signals.pagesSameSpanLastWeek} by this point last week`;
  const bestYet =
    signals.bestWeek && pages > signals.bestWeek.pages ? " · your best week yet 🎉" : "";

  return (
    <View onLayout={onLayout}>
      <Card>
        <View style={styles.head}>
          <Text style={[Type.callout, styles.title, { color: c.foreground }]}>Your week</Text>
          <Text style={[Type.caption, { color: c.faint }]}>{recap.label}</Text>
        </View>

        <View style={styles.bigRow}>
          <Text style={[Type.display, styles.tabular, { color: c.foreground }]}>{pages}</Text>
          <Text style={[Type.callout, styles.rest, { color: c.muted }]}>
            {pages === 1 ? "page" : "pages"} · {recap.activeDays} of 7 days
          </Text>
        </View>
        <Text style={[Type.footnote, styles.baseline, { color: c.faint }]}>
          {baselineLine}
          {bestYet}
        </Text>

        {/* The seven days, Monday → Sunday */}
        <View style={styles.days}>
          {recap.days.map((day, i) => {
            const bg = day.logged ? c.accent : c.surface2;
            const fg = day.logged ? c.onAccent : c.faint;
            return (
              <View key={day.d} style={styles.day}>
                <Text style={[Type.caption, { color: c.faint }]}>{WEEKDAYS[i]}</Text>
                <View
                  style={[
                    styles.circle,
                    { backgroundColor: bg },
                    day.future && styles.future,
                    // The web drew a 1px ring on today when nothing is logged
                    // yet; a border inside the 28px circle keeps the same size.
                    day.isToday && !day.logged && { borderWidth: 1, borderColor: c.accent },
                  ]}
                >
                  <Text style={[Type.caption, styles.dayNum, { color: fg }]}>
                    {day.logged ? "✓" : +day.d.slice(8, 10)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {recap.movement && (
          <Text style={[Type.footnote, styles.movement, { color: c.muted }]}>
            Bookmark this week: p.{recap.movement.from}
            {recap.movement.to !== recap.movement.from ? ` → p.${recap.movement.to}` : ""} ·{" "}
            {recap.movement.surah}
          </Text>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  // flex 1 / flexGrow 1 on a label in a row: Android (RN 0.88) can draw a
  // text that sits at its own measured width a hair narrower than it needs
  // and wrap its last word out of sight ("Your week" showed as "Your", "juz
  // this week so far" lost "far"). Taking the row's free width avoids it.
  title: { fontWeight: "600", flex: 1 },
  bigRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 8,
    rowGap: 2,
  },
  rest: { flexGrow: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
  baseline: { marginTop: 2 },
  days: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  day: { alignItems: "center", gap: 4 },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  future: { opacity: 0.4 },
  dayNum: { fontWeight: "600", fontVariant: ["tabular-nums"] },
  movement: { marginTop: 12 },
});
