import { ChevronDown } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DeleteButton } from "@/components/feed/DeleteButton";
import { Avatar, Badge, Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { timeLabel } from "@/lib/dates";
import { ENTRY_META } from "@/lib/entries";
import type { FeedCard } from "@/lib/feedGroups";
import { describeEntry, quantityLabel } from "@/lib/format";
import { pagesPhrase } from "@/lib/position";
import type { GroupMember } from "@/lib/types";

/** Web: Badge w-[5.5rem] so every line's text starts in one column. */
const BADGE_WIDTH = 88;
/** Web: pl-[3.25rem], the avatar (40) plus the row gap (12). */
const ENTRY_INDENT = 52;

/**
 * One person's day in the Feed (reference/web-pwa/app/(app)/feed/FeedClient.tsx,
 * FeedCardView): a line per entry type, the day's pages in the corner, and
 * the individual entries (with delete, for your own) underneath.
 */
export function FeedCardView({
  card,
  member,
  isMe,
  tz,
  expanded,
  onToggle,
  confirming,
  onDelete,
}: {
  card: FeedCard;
  member: GroupMember | undefined;
  isMe: boolean;
  tz: string;
  expanded: boolean;
  onToggle: () => void;
  /** Id of the entry whose delete button is armed, if any. */
  confirming: string | null;
  onDelete: (id: string) => void;
}) {
  const c = useTheme();
  const name = isMe ? "You" : (member?.display_name ?? "Member");
  const single = card.entries.length === 1;
  const only = card.entries[0];

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Avatar name={member?.display_name ?? "Member"} src={member?.avatar_url} size={40} />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[Type.callout, styles.name, { color: c.foreground }]}>
              {name}
            </Text>
            <Text style={[Type.caption, styles.time, { color: c.faint }]}>
              · {timeLabel(card.latestAt, tz)}
            </Text>
            {card.pages > 0 && (
              <Text style={[Type.caption, styles.pages, { color: c.muted }]}>
                {pagesPhrase(card.pages)}
              </Text>
            )}
            {/* On the title line, not beside the whole card as on the web: a
                column there narrowed the detail line too and cut my own
                rows' surah short ("Juz 1 · Al-B…"). */}
            {single && isMe && (
              <View style={[styles.inlineDelete, card.pages > 0 ? null : styles.pushRight]}>
                <DeleteButton
                  id={only.id}
                  confirming={confirming === only.id}
                  onPress={() => onDelete(only.id)}
                />
              </View>
            )}
          </View>
          <View style={styles.lines}>
            {card.lines.map((line) => (
              <View key={line.type} style={styles.line}>
                <Badge type={line.type} style={styles.badge} />
                <Text numberOfLines={1} style={[Type.footnote, styles.lineText, { color: c.muted }]}>
                  {line.text}
                </Text>
              </View>
            ))}
          </View>

          {!single && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={onToggle}
              hitSlop={8}
              style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
            >
              <Text style={[Type.caption, styles.toggleText, { color: c.accent }]}>
                {expanded ? "Hide entries" : `Show ${card.entries.length} entries`}
              </Text>
              {/* Web: transition-transform rotate-180. The flip is instant
                  here; the list below appears in the same frame anyway. */}
              <ChevronDown
                size={14}
                color={c.accent}
                style={expanded ? styles.chevronUp : undefined}
              />
            </Pressable>
          )}
        </View>
      </View>

      {!single && expanded && (
        <View style={[styles.entries, { borderTopColor: c.border }]}>
          {card.entries.map((e, i) => {
            const amt = quantityLabel(e);
            return (
              <View
                key={e.id}
                style={[
                  styles.entry,
                  // Web: divide-y, a hairline between rows but not above the first.
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
                ]}
              >
                <View style={styles.entryText}>
                  <Text style={[Type.caption, styles.entryStamp, { color: c.faint }]}>
                    {timeLabel(e.logged_at, tz)} · {ENTRY_META[e.entry_type].label}
                  </Text>
                  <Text numberOfLines={1} style={[Type.footnote, { color: c.foreground }]}>
                    {describeEntry(e)}
                    {amt ? <Text style={{ color: c.muted }}> · {amt}</Text> : null}
                  </Text>
                </View>
                {isMe && (
                  <DeleteButton
                    id={e.id}
                    confirming={confirming === e.id}
                    onPress={() => onDelete(e.id)}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  // Web: p-3.5.
  card: { padding: 14 },
  // Web: flex items-start gap-3.
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  body: { flex: 1, minWidth: 0 },
  // Web: flex items-baseline gap-2.
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  name: { fontWeight: "600", flexShrink: 1 },
  time: { flexShrink: 0, fontVariant: ["tabular-nums"] },
  pages: { marginLeft: "auto", flexShrink: 0, fontWeight: "500", fontVariant: ["tabular-nums"] },
  // Centred on the title line and taking none of its height: the 32 pt
  // button overhangs the 22 pt line by 5 above and below.
  inlineDelete: { alignSelf: "center", marginVertical: -8 },
  pushRight: { marginLeft: "auto" },
  // Web: mt-1.5 space-y-1.
  lines: { marginTop: 6, gap: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { width: BADGE_WIDTH, alignItems: "center", flexShrink: 0 },
  lineText: { flex: 1, minWidth: 0 },
  // Web: mt-2 inline-flex items-center gap-1.
  toggle: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  toggleText: { fontWeight: "500" },
  chevronUp: { transform: [{ rotate: "180deg" }] },
  pressed: { opacity: 0.6 },
  // Web: mt-2.5 border-t border-border pl-[3.25rem].
  entries: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingLeft: ENTRY_INDENT },
  // Web: flex items-center gap-2 py-2.
  entry: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  entryText: { flex: 1, minWidth: 0 },
  entryStamp: { fontVariant: ["tabular-nums"] },
});
