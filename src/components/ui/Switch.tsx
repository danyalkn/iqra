import { Platform, Switch as RNSwitch, type SwitchProps } from "react-native";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

/**
 * On/off toggle in the app's colours. The web drew its own 48x28 pill
 * (accent track, white thumb); native uses the system switch, which is the
 * same shape and gets the platform's own haptic and motion for free.
 * Used by Settings (celebrate, notifications), the log sheet (continue from
 * last page) and onboarding (first daily reminder).
 *
 * Android's system switch is Material's thin track under a larger thumb,
 * not the iOS pill: a white thumb on the light track all but vanished on a
 * white card. There it takes Material's colour roles from our palette: an
 * accent thumb on a translucent accent track when on, a light thumb on a
 * grey track when off.
 */
export function Switch({ value, onValueChange, disabled, ...rest }: SwitchProps) {
  const c = useTheme();
  const dark = useColorScheme() === "dark";
  const android = Platform.OS === "android";
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={
        android
          ? { false: `${c.faint}80`, true: `${c.accent}73` }
          : { false: c.border, true: c.accent }
      }
      thumbColor={android ? (value ? c.accent : dark ? c.muted : "#ffffff") : "#ffffff"}
      ios_backgroundColor={c.border}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled: !!disabled }}
      {...rest}
    />
  );
}
