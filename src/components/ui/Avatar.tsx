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

/** First letters of the first and last words. Words are runs of letters,
 *  combining marks or digits, so "Aisha (demo)" gives "AD", not the web's
 *  "A(", and the vowel marks in "عَلِي حَسَن" stay inside their words. */
function initialsFrom(name: string): string {
  const [first, ...rest] = name.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  if (!first) return "?";
  const last = rest.at(-1);
  // Array.from splits by code point, so a letter outside the BMP stays whole.
  const head = (word: string, n: number) => Array.from(word).slice(0, n).join("");
  return (last ? head(first, 1) + head(last, 1) : head(first, 2)).toUpperCase();
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
