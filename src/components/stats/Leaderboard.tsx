import { Trophy } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { SectionCard } from "@/components/stats/SectionCard";
import { Avatar } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { GroupMember } from "@/lib/types";

export type BoardRow = { member: GroupMember; all: number; month: number };

/**
 * Group leaderboard: this month + all time per member (web: the Leaderboard
 * card in StatsClient.tsx). In-app only; DECISIONS "No showing off" bans it
 * from pushes and from the personal insights, not from this group view.
 */
export function Leaderboard({
  board,
  maxMonth,
  monthName,
  userId,
}: {
  board: BoardRow[];
  /** Largest month total on the board (at least 1), the bar's full width. */
  maxMonth: number;
  monthName: string;
  userId: string;
}) {
  const c = useTheme();
  return (
    <SectionCard title={`Leaderboard · ${monthName}`}>
      <View style={styles.rows}>
        {board.map((row, i) => (
          <View key={row.member.user_id} style={styles.row}>
            <Text style={[Type.footnote, styles.rank, { color: c.faint }]}>{i + 1}</Text>
            <Avatar name={row.member.display_name} src={row.member.avatar_url} size={32} />
            <View style={styles.body}>
              <View style={styles.nameRow}>
                <View style={styles.name}>
                  <Text
                    style={[Type.subhead, styles.nameText, { color: c.foreground }]}
                    numberOfLines={1}
                  >
                    {row.member.user_id === userId ? "You" : row.member.display_name}
                  </Text>
                  {i === 0 && row.month > 0 && <Trophy size={14} color={c.accent} />}
                </View>
                <Text style={[Type.subhead, styles.month, { color: c.foreground }]}>
                  {row.month}
                  <Text style={[styles.all, { color: c.faint }]}> · {row.all} all time</Text>
                </Text>
              </View>
              <View style={[styles.track, { backgroundColor: c.surface2 }]}>
                <View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: c.accent,
                      width: `${(row.month / maxMonth) * 100}%`,
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        ))}
      </View>
      <Text style={[Type.caption, styles.note, { color: c.faint }]}>
        Pages in {monthName} · every entry type counts
      </Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rank: {
    width: 16,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0 },
  nameRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  name: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  nameText: { flexShrink: 1 },
  month: { fontWeight: "600", fontVariant: ["tabular-nums"], flexShrink: 0 },
  all: { fontWeight: "400" },
  track: { marginTop: 4, height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  note: { marginTop: 12 },
});
