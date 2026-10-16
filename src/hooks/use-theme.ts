import { Colors, type Theme } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

/** Paper & Pine palette for the current color scheme. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return Colors[scheme === "dark" ? "dark" : "light"];
}
