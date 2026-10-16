import type { ReactNode } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

/**
 * Renders the insights engine's `**bold**` markers as real emphasis. The web
 * had the same tiny parser as `emphasize()` in
 * reference/web-pwa/app/(app)/stats/StatsClient.tsx; src/lib/insights.ts is
 * shared and must keep producing the markers, so the parser lives here
 * (docs/HANDOFF.md, working notes).
 *
 * Odd parts of a split on "**" are the bold spans. Nested Text inherits the
 * outer style, so only the weight (and an optional override) is added.
 * `children` is appended inside the same Text after the parsed parts (the
 * faint "· 12×" tails the web rendered as a trailing span).
 */
export function RichText({
  text,
  style,
  boldStyle,
  numberOfLines,
  children,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  boldStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children?: ReactNode;
}) {
  const parts = text.split("**");
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={[styles.bold, boldStyle]}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({ bold: { fontWeight: "600" } });
