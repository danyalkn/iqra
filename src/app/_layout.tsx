import {
  DarkTheme,
  DefaultTheme,
  SplashScreen,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { SyncController } from "@/data/SyncController";
import { FocusController } from "@/focus/FocusController";
import { SessionProvider, useSession } from "@/providers/SessionProvider";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { PushController } from "@/push/PushController";

// Keep the splash up until the persisted session has been read, so the
// first frame is the right screen instead of a login flash.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Root layout: providers, then the auth gate.
 *
 * Gate (ported from reference/web-pwa/app/page.tsx and (app)/layout.tsx):
 *   no session            -> (auth)/login
 *   session, no profile   -> onboarding (name + mode missing)
 *   session + onboarded   -> (tabs), journal
 * `index` is never guarded: it is the anchor every guarded route falls
 * back to, and it redirects once the session is known. Without that, a
 * cold start at `/` resolved while every guard was still false and the
 * router landed on its not-found screen for good. Stack.Protected then
 * redirects as soon as a guard flips (sign-in, sign-out, onboarding
 * saved), so screens never redirect by hand.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      {/* Keyboard frames for Chat (react-native-keyboard-controller). The
          provider must sit above every screen; native module, so a dev-client
          rebuild is needed after it is added. */}
      <KeyboardProvider>
        <ThemeProvider>
          <SessionProvider>
            <SplashController />
            {/* Push: foreground handler, tap routing through the gate,
                token self-heal. Needs useSession, so it sits here. */}
            <PushController />
            {/* Offline outbox: sends queued entries when the app comes
                back and on a backoff timer while any wait. */}
            <SyncController />
            {/* Focus: keeps the Screen Time shield in step with "logged
                today" on foreground and at midnight (iOS only). */}
            <FocusController />
            <RootNavigator />
          </SessionProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function SplashController() {
  const { loading } = useSession();
  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);
  return null;
}

function RootNavigator() {
  const c = useTheme();
  const scheme = useColorScheme();
  const { loading, session, isOnboarded } = useSession();
  const signedIn = !!session;

  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.canvas,
      card: c.surface,
      text: c.foreground,
      border: c.border,
      notification: c.accent,
    },
  };

  // While the session loads only `index` (which renders null) is reachable
  // behind the splash, so no screen flashes and nothing autofocuses.
  return (
    <NavigationThemeProvider value={navTheme}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.canvas },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Protected guard={!loading && signedIn && isOnboarded}>
          <Stack.Screen name="(tabs)" />
            <Stack.Screen name="journal" options={{ presentation: "card" }} />
        </Stack.Protected>
        <Stack.Protected guard={!loading && signedIn && !isOnboarded}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={!loading && !signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </NavigationThemeProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
