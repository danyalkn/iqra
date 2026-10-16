import { Lightbulb, type LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { DeltaBadge } from "@/components/stats/DeltaBadge";
import { RichText } from "@/components/stats/RichText";
import { SectionCard } from "@/components/stats/SectionCard";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * One line of "Trends & insights". The engine's personal lines and the
 * screen's extra lines (hifz revision reads, group aggregates) share this
 * shape: `text` carries `**bold**` spans for RichText, `note` is the faint
 * tail the web rendered as a `text-faint` span after " · ".
 */
export type InsightLine = {
  key: string;
  icon: LucideIcon;
  text: string;
  note?: string;
  delta?: number | null;
};

/**
 * "Trends & insights" (web: the two Card branches in StatsClient.tsx). Mine
 * scope passes the personal engine lines plus the hifz extras and one piece
 * of advice; group scope passes the aggregate lines and no advice.
 */
export function InsightsCard({ lines, advice }: { lines: InsightLine[]; advice?: string }) {
  const c = useTheme();
  return (
    <SectionCard title="Trends & insights">
      <View style={styles.rows}>
        {lines.map((ins) => (
          <View key={ins.key} style={styles.row}>
            <View style={[styles.iconBox, { backgroundColor: c.surface2 }]}>
              <ins.icon size={18} color={c.muted} />
            </View>
            <RichText style={[Type.subhead, styles.text, { color: c.foreground }]} text={ins.text}>
              {ins.note != null && <Text style={{ color: c.faint }}> · {ins.note}</Text>}
            </RichText>
            {ins.delta != null && <DeltaBadge value={ins.delta} />}
          </View>
        ))}
      </View>
      {/* One practical suggestion, reacting to your actual patterns. */}
      {advice != null && (
        <View style={[styles.advice, { backgroundColor: c.accentTint }]}>
          <Lightbulb size={16} color={c.accent} style={styles.bulb} />
          <Text style={[Type.footnote, styles.adviceText, { color: c.accent }]}>{advice}</Text>
        </View>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  text: { flex: 1, minWidth: 0, fontWeight: "400" },
  advice: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bulb: { marginTop: 2 },
  adviceText: { flex: 1, minWidth: 0, fontWeight: "500" },
});
