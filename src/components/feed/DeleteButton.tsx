import { Trash2 } from "lucide-react-native";
import { Pressable, StyleSheet, Text } from "react-native";

import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Two-tap delete for your own feed entries: a trash icon, then a red
 * "Delete" pill to confirm (reference/web-pwa/app/(app)/feed/FeedClient.tsx,
 * DeleteButton). The parent owns which entry is armed and disarms it after
 * 4 s. Optimistic rows (temp- ids) have nothing to delete yet, so they get
 * no button at all, as on the web.
 */
export function DeleteButton({
  id,
  confirming,
  onPress,
}: {
  id: string;
  confirming: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  if (id.startsWith("temp-")) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={confirming ? "Tap again to delete this entry" : "Delete entry"}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) =>
        confirming
          ? [styles.armed, { backgroundColor: c.danger }, pressed && styles.pressed]
          : [styles.icon, pressed && { backgroundColor: c.dangerTint }]
      }
    >
      {({ pressed }) =>
        confirming ? (
          <Text style={[Type.footnote, styles.armedText, { color: c.onDanger }]}>Delete</Text>
        ) : (
          // Web: hover turned the icon red; native has no hover, so the
          // press state does the same.
          <Trash2 size={16} color={pressed ? c.danger : c.faint} />
        )
      }
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Web: size-8 rounded-full.
  icon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  // Web: px-3 py-1.5 text-footnote font-semibold rounded-full.
  armed: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  armedText: { fontWeight: "600" },
  pressed: { opacity: 0.8 },
});
