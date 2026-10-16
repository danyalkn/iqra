import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar, Card, Sheet } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { GroupMember, Reaction } from "@/lib/types";

/**
 * "Who reacted" sheet, ported from the reactors Sheet in
 * reference/web-pwa/app/(app)/chat/ChatClient.tsx: one row per reaction
 * (avatar, "You" or the member's name, the emoji). Only my own row is
 * tappable: it removes the reaction (same emoji toggles off) and closes.
 */
export function ReactorsSheet({
  open,
  onClose,
  reactions,
  memberMap,
  userId,
  onRemoveMine,
}: {
  open: boolean;
  onClose: () => void;
  reactions: Reaction[];
  memberMap: Map<string, GroupMember>;
  userId: string;
  /** Called with my reaction when I tap my own row; the caller toggles it
   *  off and closes the sheet. */
  onRemoveMine: (reaction: Reaction) => void;
}) {
  const c = useTheme();
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={styles.body}>
        <Text style={[Type.title2, styles.title, { color: c.foreground }]}>Reactions</Text>
        <View style={styles.list}>
          {reactions.map((r) => {
            const m = memberMap.get(r.user_id);
            const mine = r.user_id === userId;
            return (
              <Pressable
                key={r.user_id}
                accessibilityRole="button"
                accessibilityLabel={mine ? "Remove your reaction" : undefined}
                disabled={!mine}
                onPress={() => onRemoveMine(r)}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Card style={styles.row}>
                  <Avatar name={m?.display_name ?? "Member"} src={m?.avatar_url} size={40} />
                  <View style={styles.text}>
                    <Text
                      numberOfLines={1}
                      style={[Type.callout, styles.name, { color: c.foreground }]}
                    >
                      {mine ? "You" : (m?.display_name ?? "Member")}
                    </Text>
                    {mine && (
                      <Text style={[Type.footnote, { color: c.faint }]}>Tap to remove</Text>
                    )}
                  </View>
                  <Text style={styles.emoji}>{r.emoji}</Text>
                </Card>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Web: px-5 pt-2; the title has mb-4 and the list space-y-2 pb-2.
  body: { paddingHorizontal: 20, paddingTop: 8 },
  title: { marginBottom: 16 },
  list: { gap: 8, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  text: { flex: 1, minWidth: 0 },
  name: { fontWeight: "500" },
  emoji: { fontSize: 22, lineHeight: 26 },
  pressed: { opacity: 0.85 },
});
