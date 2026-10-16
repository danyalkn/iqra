import { Pencil, Trash2 } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Badge } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dayLabel, localDate, timeLabel } from "@/lib/dates";
import { describeEntry, quantityLabel } from "@/lib/format";
import type { LogRow } from "@/lib/types";

import { Card } from "./ui/Card";

/** One logged entry, as listed on Today and in the Journal
 *  (reference/web-pwa/components/EntryRow.tsx). */
export function EntryRow({
  entry,
  tz,
  onEdit,
  onDelete,
  withDate = false,
  fullNotes = false,
}: {
  entry: LogRow;
  tz: string;
  onEdit?: (entry: LogRow) => void;
  onDelete?: (id: string) => void;
  /** Stamp with the day as well as the time (lists that span many days). */
  withDate?: boolean;
  /** Show the whole note on its own lines instead of one truncated line. */
  fullNotes?: boolean;
}) {
  const c = useTheme();
  const amt = quantityLabel(entry);
  // Optimistic rows carry a temp id until the server copy replaces them.
  const pending = entry.id.startsWith("temp-");
  const stamp = withDate
    ? `${dayLabel(localDate(entry.logged_at, tz))} · ${timeLabel(entry.logged_at, tz)}`
    : timeLabel(entry.logged_at, tz);
  const inlineNotes = fullNotes ? null : entry.notes;
  return (
    <Card style={styles.card}>
      <View style={styles.main}>
        <View style={styles.head}>
          <Badge type={entry.entry_type} />
          <Text style={[Type.caption, styles.stamp, { color: c.faint }]}>
            {pending ? "saving…" : stamp}
          </Text>
        </View>
        <Text numberOfLines={1} style={[Type.callout, styles.title, { color: c.foreground }]}>
          {describeEntry(entry)}
        </Text>
        {(amt || inlineNotes) && (
          <Text numberOfLines={1} style={[Type.footnote, { color: c.muted }]}>
            {amt}
            {amt && inlineNotes ? " · " : ""}
            {inlineNotes && <Text style={{ color: c.faint }}>{inlineNotes}</Text>}
          </Text>
        )}
        {fullNotes && entry.notes && (
          <Text
            style={[Type.footnote, styles.fullNotes, { backgroundColor: c.surface2, color: c.foreground }]}
          >
            {entry.notes}
          </Text>
        )}
      </View>
      {!pending && (onEdit || onDelete) && (
        <View style={styles.actions}>
          {onEdit && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit entry"
              hitSlop={4}
              onPress={() => onEdit(entry)}
              style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: c.surface2 }]}
            >
              {({ pressed }) => <Pencil size={16} color={pressed ? c.foreground : c.faint} />}
            </Pressable>
          )}
          {onDelete && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete entry"
              hitSlop={4}
              onPress={() => onDelete(entry.id)}
              style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: c.dangerTint }]}
            >
              {({ pressed }) => <Trash2 size={16} color={pressed ? c.danger : c.faint} />}
            </Pressable>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  main: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  stamp: { fontVariant: ["tabular-nums"] },
  title: { marginTop: 6, fontWeight: "600" },
  fullNotes: {
    marginTop: 8,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});
