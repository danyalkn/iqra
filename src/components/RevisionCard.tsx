import { X } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Badge, Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ENTRY_META } from "@/lib/entries";
import { revisionReason, type RevisionItem } from "@/lib/revisionPlan";

/** "Sabak Para: recent revision" from the type's plain-language meaning
 *  (ENTRY_META desc up to its colon), so the card never shows bare jargon. */
function meaning(type: RevisionItem["type"]): string {
  const { label, desc } = ENTRY_META[type];
  const short = desc.split(":")[0];
  return `${label}: ${short.charAt(0).toLowerCase()}${short.slice(1)}`;
}

/**
 * "Revise today" on Today, hifz only (docs/DECISIONS.md "Revision plan"):
 * one row per juz that is due and not hidden, current juz first. Tapping a
 * row opens the log sheet for that type with the juz preselected; the X
 * hides the row for the rest of the day. Renders nothing when the list is
 * empty: no empty card.
 */
export function RevisionCard({
  items,
  onOpen,
  onHide,
}: {
  items: RevisionItem[];
  onOpen: (item: RevisionItem) => void;
  onHide: (juz: number) => void;
}) {
  const c = useTheme();
  if (items.length === 0) return null;
  const types = [...new Set(items.map((i) => i.type))];
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={[Type.callout, styles.title, { color: c.foreground }]}>Revise today</Text>
        <Text style={[Type.footnote, { color: c.faint }]}>{types.map(meaning).join(" · ")}</Text>
      </View>
      {items.map((item) => (
        <View key={item.juz} style={[styles.row, { borderTopColor: c.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Log ${ENTRY_META[item.type].label} for Juz ${item.juz}`}
            accessibilityHint={revisionReason(item)}
            onPress={() => onOpen(item)}
            style={({ pressed }) => [styles.main, pressed && { opacity: 0.6 }]}
          >
            <View style={styles.line}>
              <Text style={[Type.callout, styles.juz, { color: c.foreground }]}>Juz {item.juz}</Text>
              <Badge type={item.type} />
            </View>
            <Text style={[Type.footnote, styles.reason, { color: c.muted }]}>
              {revisionReason(item)}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Hide Juz ${item.juz} for today`}
            hitSlop={6}
            onPress={() => onHide(item.juz)}
            style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: c.surface2 }]}
          >
            {({ pressed }) => <X size={16} color={pressed ? c.foreground : c.faint} />}
          </Pressable>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 4, paddingHorizontal: 0 },
  head: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 2 },
  title: { fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 16,
    paddingRight: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  main: { flex: 1, minWidth: 0 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  juz: { fontWeight: "600" },
  reason: { marginTop: 4 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
