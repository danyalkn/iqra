import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Small, non-secret per-device preferences (theme, celebration toggle, push
 * flags). Mirrors the web app's localStorage keys so the names stay familiar.
 * Secrets never go here; the auth session lives in src/supabase/secureStorage.
 */
export const PREF_KEYS = {
  theme: "iqra:theme",
  celebrate: "iqra:celebrate",
  /** The Expo push token this install last registered, so toggle-off and
   *  sign-out delete the right push_subscriptions row even after the token
   *  rotated. Device-level: one token per install, whoever is signed in. */
  pushToken: "iqra:push-token",
} as const;

/** "1" once this user turned push on from this device (the web's
 *  `iqra:push-enabled:<userId>` flag). Gates the silent re-register on launch
 *  and after sign-in; keyed per user so two accounts sharing a phone never
 *  adopt each other's registration. */
export function pushEnabledKey(userId: string): string {
  return `iqra:push-enabled:${userId}`;
}

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
