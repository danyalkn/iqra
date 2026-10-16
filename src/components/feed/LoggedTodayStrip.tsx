import { Check } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { NudgeChip } from "@/components/feed/NudgeChip";
import { Avatar, Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { GroupMember } from "@/lib/types";

/** Web: the tick badge is size-4 (16) with a 2px ring drawn OUTSIDE the box.
 *  RN borders draw inside, so the box is 20 with a 2px border to keep the
 *  same 16px fill, and sits 4 out from the corner instead of the web's 2. */
const BADGE = 20;
const RING = 2;

/**
 * "Logged today" card at the top of the Feed
 * (reference/web-pwa/app/(app)/feed/FeedClient.tsx, the logged-today strip):
 * every member's avatar, dimmed until they log, with a tick badge; the
 * "x of n" count; and, when someone else has not logged yet, a Nudge pill
 * for each of them.
 */
export function LoggedTodayStrip({
  members,
  loggedTodayIds,
  userId,
  cooldownLeft,
  onNudge,
}: {
  members: GroupMember[];
  loggedTodayIds: Set<string>;
  userId: string;
  /** Milliseconds until a nudge to this member is allowed again (0 = now). */
  cooldownLeft: (toUser: string) => number;
  onNudge: (toUser: string) => void;
}) {
  const c = useTheme();
  const loggedCount = loggedTodayIds.size;
  // You cannot nudge yourself; your own avatar still shows in the row.
  const notLogged = members.filter(
    (m) => m.user_id !== userId && !loggedTodayIds.has(m.user_id),
  );

  return (
    <Card>
      <Text style={[Type.footnote, styles.label, { color: c.muted }]}>Logged today</Text>
      <View style={styles.avatars}>
        {members.map((m) => {
          const on = loggedTodayIds.has(m.user_id);
          return (
            <View key={m.user_id} style={styles.avatarWrap}>
              <Avatar
                name={m.display_name}
                src={m.avatar_url}
                size={44}
                style={!on ? styles.dim : undefined}
              />
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: on ? c.accent : c.surface2,
                    borderColor: c.surface,
                  },
                ]}
              >
                {on && <Check size={10} color={c.onAccent} strokeWidth={4} />}
              </View>
            </View>
          );
        })}
      </View>
      <Text style={[Type.footnote, styles.count, { color: c.faint }]}>
        {loggedCount} of {members.length} logged today
      </Text>

      {notLogged.length > 0 && (
        <View style={[styles.nudges, { borderTopColor: c.border }]}>
          {notLogged.map((m) => {
            const first = m.display_name.split(" ")[0];
            const left = cooldownLeft(m.user_id);
            return (
              <NudgeChip
                key={m.user_id}
                firstName={first}
                secondsLeft={Math.ceil(left / 1000)}
                onPress={() => onNudge(m.user_id)}
              />
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: "500" },
  // Web: mt-3 flex flex-wrap gap-3.
  avatars: { marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  avatarWrap: { position: "relative" },
  dim: { opacity: 0.5 },
  badge: {
    position: "absolute",
    bottom: -(RING + 2),
    right: -(RING + 2),
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: RING,
    alignItems: "center",
    justifyContent: "center",
  },
  count: { marginTop: 12 },
  // Web: mt-3 flex flex-wrap gap-2 border-t border-border pt-3.
  nudges: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
