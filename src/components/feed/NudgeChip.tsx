import { Bell, Check } from "lucide-react-native";
import { Pressable, StyleSheet, Text } from "react-native";

import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * One "Nudge {name}" pill under the logged-today strip
 * (reference/web-pwa/app/(app)/feed/FeedClient.tsx, the notLogged row).
 * Active: accent tint with a bell. Cooling down: neutral, disabled, and
 * counts the seconds until it re-enables ("Nudged Ali · 12s").
 *
 * Not the kit's Chip: the cooling-down look (surface-2 + faint text, no fade)
 * is its own state rather than Chip's disabled 50% opacity.
 */
export function NudgeChip({
  firstName,
  secondsLeft,
  onPress,
}: {
  firstName: string;
  /** 0 when the nudge is available; otherwise the whole seconds remaining. */
  secondsLeft: number;
  onPress: () => void;
}) {
  const c = useTheme();
  const cooling = secondsLeft > 0;
  const fg = cooling ? c.faint : c.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        cooling ? `Nudged ${firstName}, ${secondsLeft} seconds left` : `Nudge ${firstName}`
      }
      accessibilityState={{ disabled: cooling }}
      disabled={cooling}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: cooling ? c.surface2 : c.accentTint },
        // Web: active:scale-95 on the live pill only.
        pressed && !cooling && styles.pressed,
      ]}
    >
      {cooling ? (
        <Check size={14} color={fg} strokeWidth={3} />
      ) : (
        <Bell size={14} color={fg} />
      )}
      <Text style={[Type.footnote, styles.text, { color: fg }]}>
        {cooling ? `Nudged ${firstName} · ${secondsLeft}s` : `Nudge ${firstName}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Web: inline-flex items-center gap-1.5 rounded-full px-3 py-1.5.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  text: { fontWeight: "500", fontVariant: ["tabular-nums"] },
  pressed: { transform: [{ scale: 0.95 }] },
});
