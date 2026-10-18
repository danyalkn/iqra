/**
 * "Reading per week": juz of reading in each of the last 8 calendar weeks,
 * against a dashed line at a juz a week. Native-only (owner request,
 * 2026-10-18: "am I reading a juz a week, more or less?"). Reading entries
 * only; memorization has its own card (HifzBreakdownCard). The numbers come
 * from src/lib/readingWeeks.ts.
 */
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { readingJuzWeeks } from "@/lib/readingWeeks";
import type { LogRow } from "@/lib/types";

import { PagesBarChart } from "./PagesBarChart";
import { EmptyNote } from "./SectionCard";
import type { BarDatum } from "./types";

const WEEKS = 8;
/** The pace this card measures against: a khatm in 30 weeks. */
const GOAL_JUZ = 1;

export function ReadingWeeksCard({
  rows,
  tz,
  today,
  hifz,
}: {
  /** The signed-in user's entries, all time. */
  rows: LogRow[];
  tz: string;
  today: string;
  /** Hifz members also log Sabak, Sabak Para and Dhor; say they're left out. */
  hifz: boolean;
}) {
  const c = useTheme();
  const stats = useMemo(() => readingJuzWeeks(rows, tz, today, WEEKS, GOAL_JUZ), [rows, tz, today]);
  // PagesBarChart's datum calls its value `pages`; here it carries juz.
  const bars = useMemo<BarDatum[]>(
    () => stats.weeks.map((w) => ({ label: w.label, full: w.full, pages: w.juz })),
    [stats.weeks],
  );

  const { average, counted, reached } = stats;
  const averageLine =
    average == null
      ? "Your weekly average shows once a full week has passed."
      : counted === 1
        ? `${average} juz last week`
        : `${average} juz a week on average over the last ${counted} weeks · a full juz in ${reached} of them`;

  return (
    <Card>
      <View style={styles.head}>
        <Text style={[Type.callout, styles.title, { color: c.foreground }]}>Reading per week</Text>
        <Text style={[Type.caption, { color: c.faint }]}>Juz · last {WEEKS} weeks</Text>
      </View>

      {!stats.any ? (
        <EmptyNote>Log your reading to see how many juz you read each week.</EmptyNote>
      ) : (
        <>
          <View style={styles.bigRow}>
            <Text style={[Type.display, styles.tabular, { color: c.foreground }]}>
              {stats.thisWeek}
            </Text>
            <Text style={[Type.callout, { color: c.muted }]}>juz this week so far</Text>
          </View>
          <Text style={[Type.footnote, styles.sub, { color: c.faint }]}>{averageLine}</Text>

          <View style={styles.chart}>
            <PagesBarChart
              data={bars}
              height={150}
              labelEvery={2}
              maxBarWidth={26}
              suffix="juz"
              goal={GOAL_JUZ}
            />
          </View>
          <Text style={[Type.caption, styles.sub, { color: c.faint }]}>
            Dashed line: a juz a week.
            {hifz ? " Counts reading only, not Sabak, Sabak Para or Dhor." : ""}
          </Text>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { fontWeight: "600" },
  bigRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 8,
    rowGap: 2,
  },
  tabular: { fontVariant: ["tabular-nums"] },
  sub: { marginTop: 2 },
  chart: { marginTop: 12, marginBottom: 6 },
});
