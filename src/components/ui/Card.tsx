import { StyleSheet, View, type ViewProps } from "react-native";

import { Elevation, Radius, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

/** Surface card with hairline-soft elevation (web: rounded-2xl bg-surface p-4
 *  shadow-e1). Dark mode swaps the shadow for a hairline ring, as the web did. */
export function Card({ style, ...rest }: ViewProps) {
  const c = useTheme();
  const dark = useColorScheme() === "dark";
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.surface },
        dark
          ? { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }
          : Elevation.e1,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, padding: Spacing.three },
});
