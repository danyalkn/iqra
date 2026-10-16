import { StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { Mode } from "@/lib/entries";
import { describeEntry } from "@/lib/format";
import { bookmarkLabel } from "@/lib/mushaf";
import type { HifzProgress, ReadingProgress } from "@/lib/progress";
import type { LogRow } from "@/lib/types";

/**
 * The member's place in the Quran, condensed from the web Insights page's
 * "Where you are" card (reference/web-pwa/app/(app)/stats/ProgressCard.tsx)
 * to its headline lines, without the charts.
 *
 * Readers move through the mushaf in order, so their place is the bookmark.
 * Memorizers do not (Juz 30 first, then Juz 2, ...), so their place is the
 * latest sabak plus how much new memorization there is in total. A
 * memorizer who also logs plain reading has both, so both blocks show, the
 * mode's own block first.
 */
export function WhereYouAre({
  mode,
  reading,
  hifz,
  lastSabak,
}: {
  mode: Mode;
  reading: ReadingProgress | null;
  hifz: HifzProgress | null;
  /** The full row behind `hifz.latest`, for describeEntry. */
  lastSabak: LogRow | null;
}) {
  const c = useTheme();

  const readingBlock = reading ? (
    <View key="reading">
      <Text style={[Type.callout, styles.headline, { color: c.foreground }]}>
        p.{reading.page} of {reading.total}
      </Text>
      <Text style={[Type.footnote, { color: c.muted }]}>
        {bookmarkLabel(reading.mushaf, reading.page)}
        {reading.khatms > 0
          ? ` · ${reading.khatms} ${reading.khatms === 1 ? "khatm" : "khatms"} completed`
          : ""}
      </Text>
    </View>
  ) : null;

  const hifzBlock = hifz ? (
    <View key="hifz">
      <Text style={[Type.callout, styles.headline, { color: c.foreground }]}>
        {hifz.totalPages} {hifz.totalPages === 1 ? "page" : "pages"} of new memorization
      </Text>
      {lastSabak ? (
        <Text style={[Type.footnote, { color: c.muted }]}>Last sabak: {describeEntry(lastSabak)}</Text>
      ) : null}
    </View>
  ) : null;

  const blocks = (mode === "hifz" ? [hifzBlock, readingBlock] : [readingBlock, hifzBlock]).filter(
    (b) => b != null,
  );

  return (
    <Card>
      <Text style={[Type.callout, styles.title, { color: c.foreground }]}>Where you are</Text>
      {blocks.length === 0 ? (
        // Both helpers need more than "any entry": readingProgress needs a
        // reading with a to_ref page and hifzProgress needs a sabak row. The
        // Streak card above may already show a count, so point at the
        // missing kind of entry instead of claiming nothing was logged.
        <Text style={[Type.footnote, styles.empty, { color: c.muted }]}>
          {mode === "hifz"
            ? "Log a sabak and your new memorization shows up here."
            : "Log a reading with the last page you reached, and your place in the Quran shows up here."}
        </Text>
      ) : (
        blocks.map((block, i) => (
          <View key={block.key}>
            {i > 0 ? (
              <View style={[styles.hairline, { backgroundColor: c.border }]} />
            ) : (
              <View style={styles.gap} />
            )}
            {block}
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: "600" },
  headline: { fontWeight: "600" },
  empty: { marginTop: 8 },
  gap: { height: 12 },
  hairline: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
});
