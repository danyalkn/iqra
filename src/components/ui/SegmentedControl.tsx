import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type Segment<T extends string> = { value: T; label: string };

/** iOS-style segmented control - surface pill over a surface-2 track. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  style,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Kept for parity with the web prop; both sizes render subhead text. */
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: c.surface2 }, style]}>
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(s.value)}
            style={[styles.segment, active && [{ backgroundColor: c.surface }, Elevation.e1]]}
          >
            <Text
              style={[Type.subhead, styles.label, { color: active ? c.foreground : c.muted }]}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", borderRadius: Radius.md, padding: 4 },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    paddingVertical: 6,
  },
  label: { fontWeight: "500" },
});
