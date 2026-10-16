import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Selectable pill. Two looks, both from the web app:
 *   "tint"  - accent tint + accent text when active (Journal filters).
 *   "solid" - solid accent + on-accent text when active (reminder quick
 *             picks, "What for" types, repeat-on days).
 * Inactive is always surface-2 + muted text. A string child gets the chip's
 * text style; anything else (icon + text) renders as given inside a row.
 */
export function Chip({
  active,
  onPress,
  variant = "tint",
  size = "md",
  disabled,
  children,
  style,
  accessibilityLabel,
}: {
  active: boolean;
  onPress: () => void;
  variant?: "tint" | "solid";
  /** md = footnote text (web px-3 py-1.5); lg = subhead semibold (px-3.5 py-1.5). */
  size?: "md" | "lg";
  disabled?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  const bg = !active ? c.surface2 : variant === "solid" ? c.accent : c.accentTint;
  const fg = !active ? c.muted : variant === "solid" ? c.onAccent : c.accent;
  const textStyle = [
    size === "lg" ? Type.subhead : Type.footnote,
    size === "lg" ? styles.lgText : styles.mdText,
    { color: fg },
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        size === "lg" ? styles.lg : styles.md,
        { backgroundColor: bg },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {typeof children === "string" ? (
        <Text style={textStyle}>{children}</Text>
      ) : (
        <View style={styles.row}>{children}</View>
      )}
    </Pressable>
  );
}

/** Text inside a Chip whose children are a row (icon + label). */
export function ChipText({
  active,
  variant = "tint",
  size = "md",
  children,
}: {
  active: boolean;
  variant?: "tint" | "solid";
  size?: "md" | "lg";
  children: ReactNode;
}) {
  const c = useTheme();
  const fg = !active ? c.muted : variant === "solid" ? c.onAccent : c.accent;
  return (
    <Text
      style={[
        size === "lg" ? Type.subhead : Type.footnote,
        size === "lg" ? styles.lgText : styles.mdText,
        { color: fg },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 999, alignSelf: "flex-start", alignItems: "center", justifyContent: "center" },
  md: { paddingHorizontal: 12, paddingVertical: 6 },
  lg: { paddingHorizontal: 14, paddingVertical: 6, minHeight: 32 },
  mdText: { fontWeight: "500" },
  lgText: { fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
