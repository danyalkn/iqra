import { Switch as RNSwitch, type SwitchProps } from "react-native";

import { useTheme } from "@/hooks/use-theme";

/**
 * On/off toggle in the app's colours. The web drew its own 48x28 pill
 * (accent track, white thumb); native uses the system switch, which is the
 * same shape and gets the platform's own haptic and motion for free.
 * Used by Settings (celebrate, notifications), the log sheet (continue from
 * last page) and onboarding (first daily reminder).
 */
export function Switch({ value, onValueChange, disabled, ...rest }: SwitchProps) {
  const c = useTheme();
  return (
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: c.border, true: c.accent }}
      thumbColor="#ffffff"
      ios_backgroundColor={c.border}
      accessibilityRole="switch"
      accessibilityState={{ checked: !!value, disabled: !!disabled }}
      {...rest}
    />
  );
}
