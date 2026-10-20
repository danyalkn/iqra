/** Android floating glass tab bar geometry (src/components/tabBar). iOS
 *  uses the system bar and never reads these. */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_SIDE_MARGIN = 16;
export const TAB_BAR_BOTTOM_GAP = 8; // above the gesture bar inset
export const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2;
/** Live blur behind the bar. Set to false for a solid tinted bar if a
 *  phone drops frames while scrolling (docs/ANDROID.md "Performance
 *  fallback"). */
export const GLASS_BLUR = true;
