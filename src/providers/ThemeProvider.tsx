import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Appearance, useColorScheme } from "react-native";

import { Colors, type Theme } from "@/constants/theme";
import { PREF_KEYS, readPref, writePref } from "@/storage/prefs";

/** "system" follows the OS; "light" / "dark" are the Settings override
 *  (docs/DECISIONS.md § Design). Same key the web app used. */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedScheme = "light" | "dark";

type ThemeContextValue = {
  preference: ThemePreference;
  scheme: ResolvedScheme;
  colors: Theme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Push the preference down to the native layer so the keyboard, alerts and
 *  other native surfaces follow the in-app choice, not just the system.
 *  RN 0.88's setColorScheme takes "auto" (not null) to drop the override and
 *  follow the system again. */
function applyNativeScheme(preference: ThemePreference) {
  Appearance.setColorScheme(preference === "system" ? "auto" : preference);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    readPref(PREF_KEYS.theme).then((saved) => {
      if (cancelled) return;
      if (saved === "light" || saved === "dark") {
        // Runs in the async callback, so this is not a synchronous
        // setState-in-effect; the native side must be told once at startup too.
        applyNativeScheme(saved);
        setPreferenceState(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheme: ResolvedScheme =
    preference === "system" ? (system === "dark" ? "dark" : "light") : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      scheme,
      colors: Colors[scheme],
      setPreference: (next) => {
        applyNativeScheme(next);
        setPreferenceState(next);
        void writePref(PREF_KEYS.theme, next === "system" ? null : next);
      },
    }),
    [preference, scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used inside ThemeProvider");
  return ctx;
}
