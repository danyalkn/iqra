/**
 * Android tab bar: a floating, frosted, Paper & Pine tinted bar built on
 * expo-router/ui headless tabs (owner decision 2026-10-20, docs/ANDROID.md
 * section 2; Material has no glass material, so Android imitates the iOS
 * 26 bar). iOS keeps NativeTabs in _layout.tsx: Expo Router uses this
 * layout on Android only. The route context still bundles this file on
 * iOS, but there the import below resolves to the blur-free fallback
 * AndroidTabs.tsx, which is what keeps the blur package (ExpoBlur, a
 * native module missing from the iOS 1.0.0 binary) out of iOS updates.
 */
export { default } from "@/components/tabBar/AndroidTabs";
