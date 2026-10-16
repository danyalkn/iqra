import { BookOpen } from "lucide-react-native";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { Elevation } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** The Iqra brand mark - open book on the accent, matching the app icon. */
export function AppMark({ size = 64, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <View
      style={[
        styles.mark,
        Elevation.e2,
        { width: size, height: size, borderRadius: size * 0.3125, backgroundColor: c.accent },
        style,
      ]}
    >
      <BookOpen size={size * 0.5} color={c.onAccent} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center" },
});
