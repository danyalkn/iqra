import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Centered "nothing here" state: tinted icon box, a short title and a note.
 * The web had the same shape twice (EmptyState in TodayClient, Empty in
 * JournalClient); Today and the Journal share this one.
 */
export function EmptyState({
  icon: Icon,
  title,
  note,
  style,
}: {
  icon: LucideIcon;
  title: string;
  note: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <View style={[styles.root, style]}>
      <View style={[styles.iconBox, { backgroundColor: c.accentTint }]}>
        <Icon size={28} color={c.accent} strokeWidth={2} />
      </View>
      <Text style={[Type.callout, styles.title, { color: c.foreground }]}>{title}</Text>
      <Text style={[Type.footnote, styles.note, { color: c.muted }]}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", paddingHorizontal: 24, paddingTop: 40 },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { marginTop: 16, fontWeight: "600", textAlign: "center" },
  note: { marginTop: 4, maxWidth: 320, textAlign: "center" },
});
