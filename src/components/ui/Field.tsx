import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerChangeEvent,
} from "@react-native-community/datetimepicker";
import { Clock } from "lucide-react-native";
import { useState, type ComponentRef, type ReactNode, type Ref } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { Radius, Type } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

import { useRevealFocused } from "./SheetScroll";

/** Section label: footnote, uppercase, wide tracking, faint. */
export function FieldLabel({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const c = useTheme();
  return (
    <Text style={[Type.footnote, styles.label, { color: c.faint }, style]}>
      {children}
    </Text>
  );
}

type InputProps = TextInputProps & {
  style?: StyleProp<TextStyle>;
  /** React 19: ref is a plain prop. */
  ref?: Ref<ComponentRef<typeof TextInput>>;
};

/** Bordered text field; focus turns the border accent (web: focus:border-accent
 *  + a soft ring, which native approximates with a 2px accent border). Inside
 *  a SheetScroll it scrolls itself into view on focus and as it grows. */
export function Input({
  style,
  onFocus,
  onBlur,
  onContentSizeChange,
  editable = true,
  ref,
  ...rest
}: InputProps) {
  const c = useTheme();
  const scheme = useColorScheme();
  const [focused, setFocused] = useState(false);
  const reveal = useRevealFocused();
  return (
    <TextInput
      ref={ref}
      // iOS keyboard follows the resolved in-app scheme (also set natively by
      // ThemeProvider; this covers the first frames and Android no-ops it).
      keyboardAppearance={scheme}
      placeholderTextColor={c.faint}
      selectionColor={c.accent}
      editable={editable}
      onFocus={(e) => {
        setFocused(true);
        reveal?.();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      onContentSizeChange={(e) => {
        // A note growing a line keeps its caret line above the keyboard.
        if (focused && rest.multiline) reveal?.();
        onContentSizeChange?.(e);
      }}
      style={[
        styles.input,
        Type.callout,
        {
          color: c.foreground,
          backgroundColor: c.surface,
          borderColor: focused ? c.accent : c.border,
        },
        !editable && styles.disabled,
        style,
      ]}
      {...rest}
    />
  );
}

/** Multi-line variant (web: min-h-[88px] resize-none). */
export function Textarea({ style, ...rest }: InputProps) {
  return (
    <Input multiline textAlignVertical="top" style={[styles.textarea, style]} {...rest} />
  );
}

function hmToDate(hm: string): Date {
  const [h, m] = hm.split(":").map((n) => Number(n));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 6, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function dateToHm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function hmLabel(hm: string): string {
  return hmToDate(hm).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Time field in the app's bordered frame (clock glyph + picker). Value is
 *  "HH:MM". iOS shows the compact inline picker; Android opens the system
 *  time dialog on press. */
export function TimeInput({
  value,
  onChange,
  disabled,
  accessibilityLabel,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const frame = [
    styles.timeFrame,
    { backgroundColor: c.surface, borderColor: c.border },
    disabled && styles.disabled,
    style,
  ];

  if (Platform.OS === "ios") {
    return (
      <View style={frame}>
        <Clock size={16} color={c.faint} />
        <View style={styles.grow} />
        <DateTimePicker
          value={hmToDate(value)}
          mode="time"
          display="compact"
          disabled={disabled}
          accessibilityLabel={accessibilityLabel}
          // onValueChange replaces the deprecated onChange; it only fires
          // when a time is picked, so no event.type check is needed.
          onValueChange={(_e: DateTimePickerChangeEvent, date: Date) =>
            onChange(dateToHm(date))
          }
        />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      style={frame}
      onPress={() =>
        DateTimePickerAndroid.open({
          value: hmToDate(value),
          mode: "time",
          is24Hour: false,
          // Fires only on confirm; dismiss goes to onDismiss, which we ignore.
          onValueChange: (_e: DateTimePickerChangeEvent, date: Date) =>
            onChange(dateToHm(date)),
        })
      }
    >
      <Clock size={16} color={c.faint} />
      <Text style={[Type.callout, { color: c.foreground }]}>{hmLabel(value)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: 8,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.65,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textarea: { minHeight: 88 },
  timeFrame: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 46,
  },
  grow: { flex: 1 },
  disabled: { opacity: 0.4 },
});
