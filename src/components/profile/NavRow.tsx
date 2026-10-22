import { ChevronRight, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * A tappable row inside a padding-0 Card: icon in a 36px box, title with a
 * footnote underneath, chevron on the right. Rows after the first draw a
 * hairline on top, like the web's divide-y lists. The Card clips overflow so
 * the pressed surface2 fill respects its corners.
 */
export function NavRow({
  icon: Icon,
  iconColor,
  iconBackground,
  title,
  note,
  onPress,
  first = false,
}: {
  icon: LucideIcon;
  iconColor: string;
  iconBackground: string;
  title: string;
  note: string;
  onPress: () => void;
  first?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={note}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
        pressed && { backgroundColor: c.surface2 },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: iconBackground }]}>
        <Icon size={20} color={iconColor} />
      </View>
      <View style={styles.text}>
        <Text style={[Type.body, styles.title, { color: c.foreground }]}>{title}</Text>
        {/* Two lines, not one: the Journal row's note was cut at "with your
            not…" at the default text size. */}
        <Text style={[Type.footnote, { color: c.muted }]} numberOfLines={2}>
          {note}
        </Text>
      </View>
      <ChevronRight size={18} color={c.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontWeight: "500" },
});
