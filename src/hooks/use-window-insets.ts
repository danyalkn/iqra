import { Platform } from "react-native";
import {
  initialWindowMetrics,
  useSafeAreaInsets,
  type EdgeInsets,
} from "react-native-safe-area-context";

/**
 * The device window's safe-area insets, for Modals that cover the whole
 * window (sheets, the chat overlay, the photo viewer). On iOS every
 * NativeTabs screen has its own SafeAreaProvider whose bottom inset is the
 * tab bar plus the home indicator (83 pt on an iPhone 16 Pro, not 34), so
 * a sheet opened from a tab left an empty band under its last button and
 * the chat menu thought the screen ended above the tab bar. iOS is
 * portrait only here and an iPhone's insets never change, so the launch
 * metrics are exact. Android's tab bar is ours and adds nothing to the
 * insets, so it keeps the live values (gesture vs button navigation can
 * change while the app runs).
 */
export function useWindowInsets(): EdgeInsets {
  const insets = useSafeAreaInsets();
  return Platform.OS === "ios" && initialWindowMetrics ? initialWindowMetrics.insets : insets;
}
