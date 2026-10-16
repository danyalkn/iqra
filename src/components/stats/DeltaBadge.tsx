import { Minus, TrendingDown, TrendingUp } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** ▲ 12% / ▼ 8% / - steady. Icon + number together, never color alone
 *  (web: DeltaBadge in StatsClient.tsx). */
export function DeltaBadge({ value }: { value: number }) {
  const c = useTheme();
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) {
    return (
      <View style={[styles.pill, { backgroundColor: c.surface2 }]}>
        <Minus size={12} color={c.muted} />
        <Text style={[Type.caption, { color: c.muted }]}>steady</Text>
      </View>
    );
  }
  const up = value > 0;
  const fg = up ? c.accent : c.danger;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <View style={[styles.pill, { backgroundColor: up ? c.accentTint : c.dangerTint }]}>
      <Icon size={12} color={fg} />
      <Text style={[Type.caption, styles.pct, { color: fg }]}>{pct > 999 ? ">999" : pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    flexShrink: 0,
  },
  pct: { fontWeight: "600", fontVariant: ["tabular-nums"] },
});
