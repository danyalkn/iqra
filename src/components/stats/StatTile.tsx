import { Info } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * One cell of the 2x2 stat grid (web: StatCard in StatsClient.tsx). The
 * optional info affordance opens the "About these numbers" sheet; it sits
 * in the top-right corner, nudged into the card's padding like the web's
 * -mr-1 -mt-0.5.
 */
export function StatTile({
  label,
  value,
  sub,
  onInfo,
}: {
  label: string;
  value: number | string;
  sub: string;
  /** When set, shows an info affordance explaining where the number comes from. */
  onInfo?: () => void;
}) {
  const c = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={[Type.footnote, styles.label, { color: c.muted }]}>{label}</Text>
        {onInfo && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`About ${label}`}
            onPress={onInfo}
            hitSlop={8}
            style={({ pressed }) => [styles.info, pressed && styles.pressed]}
          >
            <Info size={14} color={c.faint} />
          </Pressable>
        )}
      </View>
      <Text style={[Type.title1, styles.value, { color: c.foreground }]}>{value}</Text>
      <Text style={[Type.footnote, { color: c.faint }]}>{sub}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 4,
  },
  // flex 1, not flexShrink: Android can draw a label at its own measured
  // width a hair too narrow and wrap its last word away (RecapCard).
  label: { fontWeight: "500", flex: 1 },
  info: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: -4,
    marginTop: -2,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  value: { marginTop: 8, fontVariant: ["tabular-nums"] },
});
