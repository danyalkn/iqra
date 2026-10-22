import { createContext, useContext, type ReactNode } from "react";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

const WindowInsetsContext = createContext<EdgeInsets | null>(null);

/**
 * Mounted once in the root layout, which sits inside Expo Router's own
 * SafeAreaProvider and above every screen's: the insets read there are the
 * device window's, live.
 */
export function WindowInsetsProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <WindowInsetsContext.Provider value={insets}>{children}</WindowInsetsContext.Provider>;
}

/**
 * The device window's safe-area insets, for Modals that cover the whole
 * window (sheets, the chat overlay, the photo viewer). On iOS every
 * NativeTabs screen has its own SafeAreaProvider whose bottom inset is the
 * tab bar plus the home indicator (83 pt on an iPhone 16 Pro, not 34), so
 * a sheet opened from a tab left an empty band under its last button and
 * the chat menu thought the screen ended above the tab bar. The launch
 * metrics (initialWindowMetrics) were the first fix, but they are null for
 * a process started in the background by a reminder button, so the root's
 * live values are carried down instead. Outside the provider (never in the
 * app) this falls back to the nearest provider's insets.
 */
export function useWindowInsets(): EdgeInsets {
  const own = useSafeAreaInsets();
  return useContext(WindowInsetsContext) ?? own;
}
