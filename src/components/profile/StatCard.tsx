import { StyleSheet, Text } from "react-native";

import { Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * One of the two personal stat tiles, same rhythm as the Streak / Logged
 * today cards in reference/web-pwa/app/(app)/today/TodayClient.tsx:
 * footnote label, title1 tabular number, footnote sub-line.
 */
export function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  const c = useTheme();
  return (
    <Card style={styles.card}>
      <Text style={[Type.footnote, styles.label, { color: c.muted }]}>{label}</Text>
      <Text style={[Type.title1, styles.value, { color: c.foreground }]}>{value}</Text>
      <Text style={[Type.footnote, { color: c.faint }]}>{sub}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  label: { fontWeight: "500" },
  value: { marginTop: 8, fontVariant: ["tabular-nums"] },
});
