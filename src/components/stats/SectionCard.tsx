import { TrendingUp } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** A titled card (web: the local `Card` in StatsClient.tsx: rounded-2xl
 *  bg-surface p-4 shadow-e1 with a callout semibold title, mb-3). */
export function SectionCard({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <Card style={style}>
      <Text style={[Type.callout, styles.title, { color: c.foreground }]}>{title}</Text>
      {children}
    </Card>
  );
}

/** Empty-chart placeholder (web: `Empty` in StatsClient.tsx): a faint trend
 *  icon over one short line, centred, capped at the web's max-w-[15rem]. */
export function EmptyNote({ children }: { children: string }) {
  const c = useTheme();
  return (
    <View style={styles.empty}>
      <TrendingUp size={24} color={c.faint} />
      <Text style={[Type.footnote, styles.emptyText, { color: c.muted }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: "600", marginBottom: 12 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyText: { maxWidth: 240, textAlign: "center" },
});
