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
  /** Notification response ids already turned into a log entry (JSON array,
   *  capped), so the Android task and the foreground listener never write
   *  the same tap twice. */
  pushLogged: "iqra:push-logged",
  /** Prefix of the per-user "hidden for today" revision rows (see
   *  revisionHiddenKey). */
  revisionHidden: "iqra:revision-hidden",
} as const;

/** "1" once this user turned push on from this device (the web's
 *  `iqra:push-enabled:<userId>` flag). Gates the silent re-register on launch
 *  and after sign-in; keyed per user so two accounts sharing a phone never
 *  adopt each other's registration. */
export function pushEnabledKey(userId: string): string {
  return `iqra:push-enabled:${userId}`;
}

/** Revision plan rows the member hid on Today, `iqra:revision-hidden:<userId>`
 *  holding `{ date, juz }` (docs/DECISIONS.md "Revision plan"): a hidden row
 *  stays hidden for that profile-local date only and comes back tomorrow if
 *  still due. Per user, like the push flag. */
export function revisionHiddenKey(userId: string): string {
  return `${PREF_KEYS.revisionHidden}:${userId}`;
}

/** The juz hidden on `date`; a stored list for any other date is stale and
 *  reads as nothing hidden. */
export async function readRevisionHidden(userId: string, date: string): Promise<number[]> {
  try {
    const raw = await readPref(revisionHiddenKey(userId));
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return [];
    const { date: d, juz } = v as { date?: unknown; juz?: unknown };
    if (d !== date || !Array.isArray(juz)) return [];
    return juz.filter((j): j is number => typeof j === "number");
  } catch {
    return [];
  }
}

export async function writeRevisionHidden(
  userId: string,
  date: string,
  juz: number[],
): Promise<void> {
  await writePref(revisionHiddenKey(userId), JSON.stringify({ date, juz }));
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
