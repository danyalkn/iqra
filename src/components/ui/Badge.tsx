import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ENTRY_META, type EntryType } from "@/lib/entries";

/** Entry-type badge. New bucket = accent tint, Revision = neutral - keeps the
 *  one-accent discipline (accent only ever means "new"). */
export function Badge({ type, style }: { type: EntryType; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  const meta = ENTRY_META[type];
  const isNew = meta.bucket === "new";
  return (
    <View
      style={[styles.pill, { backgroundColor: isNew ? c.accentTint : c.surface2 }, style]}
    >
      <Text style={[Type.caption, styles.text, { color: isNew ? c.accent : c.muted }]}>
        {meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: { fontWeight: "500", letterSpacing: 0.3 },
});
