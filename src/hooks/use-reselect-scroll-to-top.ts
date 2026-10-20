import { useScrollToTop } from "expo-router";
import { Platform } from "react-native";

type ScrollToTopRef = Parameters<typeof useScrollToTop>[0];

/** Never points at anything, so the hook subscribes and does nothing. */
const INERT_REF: ScrollToTopRef = { current: null };

/**
 * Re-tapping the selected tab scrolls its screen back to the top, as the
 * 1.0.0 Android bar did through react-native-screens and as the iOS system
 * bar still does natively. The Android glass bar (expo-router/ui headless
 * tabs) only emits the navigator's tabPress event, so each screen does the
 * scroll itself with React Navigation's useScrollToTop. iOS gets an inert
 * ref: the system bar already scrolls there and a second JS scroll would
 * fight it (review finding 2026-10-20).
 */
export function useReselectScrollToTop(ref: ScrollToTopRef): void {
  useScrollToTop(Platform.OS === "android" ? ref : INERT_REF);
}
