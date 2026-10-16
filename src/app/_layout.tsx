import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

import { Colors } from "@/constants/theme";

/**
 * Root layout. The target shape (see docs/HANDOFF.md § Navigation):
 *   (auth)/login, onboarding  - unauthenticated
 *   (tabs)/today|feed|chat|stats|journal - the app, native tabs
 *   settings - pushed modal/stack over the tabs
 * Auth gating lives here once the Supabase session provider exists.
 */
export default function RootLayout() {
  const scheme = useColorScheme();
  const c = Colors[scheme === "dark" ? "dark" : "light"];
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.canvas,
      card: c.surface,
      text: c.foreground,
      border: c.border,
    },
  };
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />
    </ThemeProvider>
  );
}
