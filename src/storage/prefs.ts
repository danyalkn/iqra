import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Small, non-secret per-device preferences (theme, celebration toggle, push
 * flags). Mirrors the web app's localStorage keys so the names stay familiar.
 * Secrets never go here; the auth session lives in src/supabase/secureStorage.
 */
export const PREF_KEYS = {
  theme: "iqra:theme",
  celebrate: "iqra:celebrate",
} as const;

export async function readPref(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writePref(key: string, value: string | null): Promise<void> {
  try {
    if (value == null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the preference just does not persist this launch.
  }
}
