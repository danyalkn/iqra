/**
 * Fallback for every platform but Android, and load-bearing: do not delete
 * it. expo-router's route context bundles src/app/(tabs)/_layout.android.tsx
 * on iOS too (only its route is ignored there), and on iOS Metro resolves
 * that file's import of this module here instead of to
 * AndroidTabs.android.tsx. That is what keeps the blur package (ExpoBlur, a
 * native module missing from the iOS 1.0.0 binary) out of the iOS bundle.
 * Never rendered: iOS uses NativeTabs in _layout.tsx. It must not import
 * the blur package.
 */
export default function AndroidTabs(): null {
  return null;
}
