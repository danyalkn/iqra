/**
 * Iqra design tokens - "Paper & Pine", ported 1:1 from the web app's
 * globals.css (see reference/web-pwa/ and docs/HANDOFF.md § Design).
 * Warm paper neutrals, one deep manuscript-green accent, iOS type ramp,
 * hairline borders, soft layered depth. Light + dark.
 */
import { Platform } from "react-native";

export const Colors = {
  light: {
    canvas: "#faf8f3", // app background - warm paper
    surface: "#ffffff", // cards
    surface2: "#f3f0e9", // subtle inset surfaces
    border: "#e7e2d8", // hairlines
    foreground: "#1c1b19", // primary text - warm near-black
    muted: "#6b6760", // secondary text
    faint: "#9a958c", // tertiary text / placeholders
    accent: "#157f43", // emerald green
    accentHover: "#116b38",
    accentTint: "#e7f6ec",
    onAccent: "#ffffff",
    warn: "#b5791f",
    warnTint: "#f6ecd9",
    danger: "#b4453a",
    dangerTint: "#f6e3e0",
    // Ordinal chart ramp: Sabak -> Sabak Para -> Dhor (new -> oldest)
    chart1: "#157f43",
    chart2: "#3d9c65",
    chart3: "#66bd8b",
  },
  dark: {
    canvas: "#0e0f0d",
    surface: "#181915",
    surface2: "#20221c",
    border: "#2a2c25",
    foreground: "#ecebe6",
    muted: "#a4a199",
    faint: "#6f6d66",
    accent: "#8ed4a6", // soft pastel green for dark
    accentHover: "#a0ddb4",
    accentTint: "#19271f",
    onAccent: "#07160d",
    warn: "#d9a24a",
    warnTint: "#2a2113",
    danger: "#e06a5c",
    dangerTint: "#2c1815",
    chart1: "#8ed4a6",
    chart2: "#5fae7f",
    chart3: "#3b8a5c",
  },
} as const;

export type Theme = { [K in keyof typeof Colors.light]: string };
export type ThemeColor = keyof Theme;

/** iOS type ramp (px). Web used rem; 1rem = 16px. */
export const Type = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" },
  subhead: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  callout: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  title3: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "600" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700" },
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700", letterSpacing: -0.68 },
} as const;

export const Radius = { sm: 8, md: 12, lg: 16, xl: 20, "2xl": 28 } as const;

export const Spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32, six: 64 } as const;

/** Elevation. iOS: soft layered shadows. Android: elevation. Dark mode on
 *  web leaned on hairline rings instead of shadows - do the same here. */
export const Elevation = {
  e1: Platform.select({
    ios: { shadowColor: "#1c1b19", shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
    android: { elevation: 1 },
    default: {},
  }),
  e2: Platform.select({
    ios: { shadowColor: "#1c1b19", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 3 },
    default: {},
  }),
  e3: Platform.select({
    ios: { shadowColor: "#1c1b19", shadowOpacity: 0.1, shadowRadius: 32, shadowOffset: { width: 0, height: 12 } },
    android: { elevation: 8 },
    default: {},
  }),
} as const;

export const Fonts = Platform.select({
  ios: { sans: "system-ui", rounded: "ui-rounded", mono: "ui-monospace" },
  default: { sans: "normal", rounded: "normal", mono: "monospace" },
});
