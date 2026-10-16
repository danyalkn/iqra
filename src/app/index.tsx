import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Radius, Spacing, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { describeEntry } from "@/lib/format";

/** Placeholder home. Proves the shared logic compiles under RN - replace with
 *  the real auth gate + Today screen (docs/HANDOFF.md, Phase 1). */
export default function Index() {
  const c = useTheme();
  const sample = describeEntry({
    id: "demo",
    user_id: "demo",
    group_id: "demo",
    entry_type: "reading",
    from_ref: "1",
    to_ref: "5",
    amount: 5,
    unit: "page",
    juz: null,
    part: null,
    pages_equiv: 5,
    mushaf: null,
    notes: null,
    logged_at: new Date().toISOString(),
  });
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.canvas }]}>
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[Type.title1, { color: c.foreground }]}>Iqra</Text>
        <Text style={[Type.body, { color: c.muted }]}>Native app, migration in progress.</Text>
        <Text style={[Type.footnote, { color: c.faint }]}>Shared lib check: {sample}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: Spacing.four },
  card: { padding: Spacing.four, borderRadius: Radius.xl, borderWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
});
