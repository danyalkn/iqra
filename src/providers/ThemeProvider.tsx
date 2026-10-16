import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    readPref(PREF_KEYS.theme).then((saved) => {
      if (cancelled) return;
      if (saved === "light" || saved === "dark") setPreferenceState(saved);
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
