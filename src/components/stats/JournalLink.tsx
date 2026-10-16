import { router } from "expo-router";
import { ChevronRight, NotebookPen } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** "Notes live in the Journal" row at the foot of the personal view (web:
 *  the `<Link href="/journal">` card in StatsClient.tsx). */
export function JournalLink({ noteCount }: { noteCount: number }) {
  const c = useTheme();
  const note =
    noteCount > 0
      ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}, by day or by juz`
      : "Every entry you’ve logged, by day or by juz";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Journal"
      accessibilityHint={note}
      onPress={() => router.push("/journal")}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: c.accentTint }]}>
          <NotebookPen size={18} color={c.accent} />
        </View>
        <View style={styles.text}>
          <Text style={[Type.callout, styles.title, { color: c.foreground }]}>Journal</Text>
          <Text style={[Type.footnote, { color: c.muted }]}>{note}</Text>
        </View>
        <ChevronRight size={20} color={c.faint} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontWeight: "600" },
  pressed: { opacity: 0.8 },
});
