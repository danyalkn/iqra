import type { ResolvedScheme } from "@/providers/ThemeProvider";
import { useThemeContext } from "@/providers/ThemeProvider";

/** The resolved scheme ("light" | "dark") after the manual override. */
export function useColorScheme(): ResolvedScheme {
  return useThemeContext().scheme;
}
