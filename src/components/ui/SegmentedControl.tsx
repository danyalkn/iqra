import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

export type Segment<T extends string> = { value: T; label: string };

/** Dark-mode fill for the selected segment. Dark surface (#181915) is darker
 *  than the surface-2 track (#20221c), so surface alone reads as a hole; this
 *  sits a step lighter than the track so the pill stands out. */
const DARK_ACTIVE_FILL = "#32352d";

/** iOS-style segmented control - surface pill over a surface-2 track. Light
 *  mode lifts the pill with a shadow; dark mode swaps it for a hairline ring
 *  (as Card does) because shadows are invisible on a dark track. */
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
  const dark = useColorScheme() === "dark";
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
            style={[
              styles.segment,
              active &&
                (dark
                  ? { backgroundColor: DARK_ACTIVE_FILL, borderColor: c.border }
                  : [{ backgroundColor: c.surface }, Elevation.e1]),
            ]}
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
    // Always reserved (transparent when inactive) so selecting a segment
    // never shifts the layout by the ring width.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  label: { fontWeight: "500" },
});
