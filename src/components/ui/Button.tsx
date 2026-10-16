import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

type Props = Omit<PressableProps, "style" | "children"> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** A string gets the variant's text style; anything else renders as-is. */
  children?: ReactNode;
};

/** Ported from reference/web-pwa/components/ui/Button.tsx. Press feedback is
 *  the web's `active:scale-[0.98]`; disabled/loading fade to 50%. */
export function Button({
  variant = "primary",
  size = "lg",
  loading = false,
  fullWidth = false,
  disabled,
  style,
  textStyle,
  children,
  ...rest
}: Props) {
  const c = useTheme();
  const palette: Record<Variant, { bg: string; fg: string; shadow?: object }> = {
    primary: { bg: c.accent, fg: c.onAccent, shadow: Elevation.e2 },
    secondary: { bg: c.surface2, fg: c.foreground },
    ghost: { bg: "transparent", fg: c.accent },
    danger: { bg: c.danger, fg: c.onDanger, shadow: Elevation.e2 },
  };
  const p = palette[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        size === "lg" ? styles.lg : styles.md,
        { backgroundColor: p.bg },
        p.shadow,
        fullWidth && styles.full,
        pressed && !inactive && styles.pressed,
        pressed && variant === "ghost" && { backgroundColor: c.accentTint },
        pressed && variant === "primary" && { backgroundColor: c.accentHover },
        inactive && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading && <ActivityIndicator size="small" color={p.fg} />}
      {typeof children === "string" ? (
        <Text
          style={[
            size === "lg" ? Type.callout : Type.subhead,
            styles.label,
            { color: p.fg },
            textStyle,
          ]}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  md: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: Radius.sm },
  lg: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: Radius.md },
  full: { alignSelf: "stretch" },
  label: { fontWeight: "600" },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
});
