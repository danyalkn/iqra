import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TAB_BAR_BOTTOM_GAP, TAB_BAR_HEIGHT } from "@/constants/tabBar";

/**
 * Distance from the bottom of a tab screen to the top of the tab bar, for
 * content that must not end under it (list padding, the Today FAB, the
 * chat composer). Every tab screen reaches the window bottom on both
 * platforms. iOS: the system Liquid Glass bar floats over the screen and
 * insets.bottom there is already the bar plus the home indicator (the
 * NativeTabs screen has its own SafeAreaProvider), so the value is
 * insets.bottom, exactly what the screens added before this hook.
 * Android: our floating glass bar sits TAB_BAR_BOTTOM_GAP above the
 * gesture bar inset, so the clearance is inset + gap + bar height.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android"
    ? insets.bottom + TAB_BAR_BOTTOM_GAP + TAB_BAR_HEIGHT
    : insets.bottom;
}
