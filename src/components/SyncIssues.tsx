import { CloudOff } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { Button, Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { dayLabel, localDate, timeLabel } from "@/lib/dates";
import { describeEntry } from "@/lib/format";
import { outboxRow, type OutboxItem } from "@/lib/outbox";

/**
 * Entries from the offline outbox that the server refused (docs/NEXT-SESSION.md
 * "Rules and decisions"): never dropped silently, the member decides. A
 * yesterday entry that arrived after its 3 AM window can be logged for
 * today instead; anything else can be tried again. Either can be discarded.
 * Listed whatever their date, since a refused entry never reached the list
 * of the day it was for.
 */
export function SyncIssues({
  items,
  tz,
  onLogToday,
  onRetry,
  onDiscard,
}: {
  items: OutboxItem[];
  tz: string;
  onLogToday: (item: OutboxItem) => void;
  onRetry: (item: OutboxItem) => void;
  onDiscard: (item: OutboxItem) => void;
}) {
  const c = useTheme();
  if (items.length === 0) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <CloudOff size={16} color={c.danger} />
        <Text style={[Type.callout, styles.title, { color: c.foreground }]}>
          {items.length === 1 ? "Couldn’t sync this entry" : "Couldn’t sync these entries"}
        </Text>
      </View>
      {items.map((item) => {
        const row = outboxRow(item);
        const when = `${dayLabel(localDate(row.logged_at, tz))} · ${timeLabel(row.logged_at, tz)}`;
        const closed = item.reason === "closed";
        return (
          <View key={item.id} style={[styles.item, { borderTopColor: c.border }]}>
            <Text numberOfLines={1} style={[Type.callout, styles.what, { color: c.foreground }]}>
              {describeEntry(row)}
            </Text>
            <Text style={[Type.footnote, { color: c.muted }]}>
              {when}
              {" · "}
              {closed
                ? "Yesterday closed at 3 AM, so it can’t be saved there anymore."
                : (item.message ?? "The server didn’t accept it.")}
            </Text>
            <View style={styles.actions}>
              {closed ? (
                <Button size="md" onPress={() => onLogToday(item)}>
                  Log for today
                </Button>
              ) : (
                <Button size="md" onPress={() => onRetry(item)}>
                  Try again
                </Button>
              )}
              <Button size="md" variant="secondary" onPress={() => onDiscard(item)}>
                Discard
              </Button>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 6 },
  title: { fontWeight: "600" },
  item: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, paddingBottom: 4, gap: 2 },
  what: { fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8, paddingTop: 8 },
});
