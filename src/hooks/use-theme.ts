import type { Theme } from "@/constants/theme";
import { useThemeContext } from "@/providers/ThemeProvider";

/** Paper & Pine palette for the active scheme (system or the Settings
 *  override). Must be used inside ThemeProvider (the root layout). */
export function useTheme(): Theme {
  return useThemeContext().colors;
}
