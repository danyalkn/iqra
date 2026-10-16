import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** On-brand stub for screens being built in a later step, and the "not in a
 *  circle yet" state of the group screens (reference/web-pwa/components/Placeholder.tsx). */
export function Placeholder({
  icon: Icon,
  title,
  note,
  headerRight,
  children,
}: {
  icon: LucideIcon;
  title: string;
  note: string;
  headerRight?: ReactNode;
  children?: ReactNode;
}) {
  const c = useTheme();
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={[Type.display, { color: c.foreground }]}>{title}</Text>
        {headerRight}
      </View>
      <View style={styles.body}>
        <View style={[styles.iconBox, { backgroundColor: c.accentTint }]}>
          <Icon size={28} color={c.accent} strokeWidth={2} />
        </View>
        <Text style={[Type.callout, styles.note, { color: c.muted }]}>{note}</Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 12,
  },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  iconBox: { width: 64, height: 64, borderRadius: Radius.lg, alignItems: "center", justifyContent: "center" },
  note: { textAlign: "center", maxWidth: 320 },
});
