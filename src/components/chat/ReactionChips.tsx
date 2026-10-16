import { Pressable, StyleSheet, Text } from "react-native";

import { Elevation, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { Reaction } from "@/lib/types";

/**
 * Grouped reaction chip hugging the bubble's bottom corner (IG style).
 * Ported from ReactionChips in reference/web-pwa/app/(app)/chat/ChatClient.tsx:
 * up to three distinct emoji plus the count when more than one person
 * reacted. The web's dialIn animation is dropped (the chip appears with the
 * optimistic row; a 170 ms pop on every recycled cell would misfire).
 */
export function ReactionChips({
  reactions,
  mine,
  onOpen,
}: {
  reactions: Reaction[];
  mine: boolean;
  onOpen: () => void;
}) {
  const c = useTheme();
  if (reactions.length === 0) return null;
  const emojis: string[] = [];
  for (const r of reactions) {
    if (!emojis.includes(r.emoji)) emojis.push(r.emoji);
    if (emojis.length === 3) break;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reactions.length} ${reactions.length === 1 ? "reaction" : "reactions"}: ${emojis.join(" ")}`}
      accessibilityHint="Shows who reacted"
      onPress={onOpen}
      hitSlop={6}
      style={[
        styles.chip,
        Elevation.e1,
        { backgroundColor: c.surface, borderColor: c.border },
        mine ? styles.right : styles.left,
      ]}
    >
      <Text style={styles.emoji}>{emojis.join("")}</Text>
      {reactions.length > 1 && (
        <Text style={[Type.caption, styles.count, { color: c.muted }]}>{reactions.length}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Web: absolute -bottom-3.5 z-10 rounded-full px-1.5 py-0.5 ring-1.
  chip: {
    position: "absolute",
    bottom: -14,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  right: { right: 4 },
  left: { left: 4 },
  emoji: { fontSize: 13, lineHeight: 18 },
  count: { marginLeft: 2, fontVariant: ["tabular-nums"] },
});
