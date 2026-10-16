import { Image } from "expo-image";
import {
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/hooks/use-theme";

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 40,
  style,
}: {
  name: string;
  src?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (src) {
    return (
      <Image
        source={{ uri: src }}
        accessibilityLabel={name}
        contentFit="cover"
        style={[round, style as StyleProp<ImageStyle>]}
      />
    );
  }
  return (
    <View
      accessibilityLabel={name}
      style={[styles.fallback, round, { backgroundColor: c.accentTint }, style]}
    >
      <Text style={[styles.initials, { color: c.accent, fontSize: size * 0.34 }]}>
        {initialsFrom(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  initials: { fontWeight: "600" },
});
