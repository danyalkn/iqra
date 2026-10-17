import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Profile } from "@/lib/auth";
import type { DayReminder, LogRow, Membership } from "@/lib/types";
import type { HifzHistoryRow } from "@/data/entryReads";

/**
 * The last good copy of what the app needs to work offline
 * (docs/NEXT-SESSION.md "Cached reads"), per user, in AsyncStorage
 * (`iqra:cache:<kind>:<userId>`): the profile and circle the gate and the
 * log sheet need, and Today's rows. Written whenever a read lands, read when
 * a read fails. Not secret but private (the member's own entries and their
 * circle's name), so every kind is dropped on sign-out and account deletion.
 */

export type TodayCache = {
  /** Today's 120-day read (getMyRecentEntries' window). */
  entries: LogRow[];
  /** Today's and tomorrow's one-time reminders, as read. */
  reminders: DayReminder[];
};

export type HifzCache = {
  rows: HifzHistoryRow[];
  /** The instant below which these rows are used instead of Today's
   *  window (today.tsx mergeRevisionEntries). */
  cutoff: string;
};

type Kinds = {
  profile: Profile;
  /** `{ m: null }` = signed in but not in a circle. */
  membership: { m: Membership | null };
  today: TodayCache;
  hifz: HifzCache;
};

type Kind = keyof Kinds;
const KINDS: Kind[] = ["profile", "membership", "today", "hifz"];

function cacheKey(kind: Kind, userId: string): string {
  return `iqra:cache:${kind}:${userId}`;
}

export async function readCache<K extends Kind>(kind: K, userId: string): Promise<Kinds[K] | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(kind, userId));
    return raw ? (JSON.parse(raw) as Kinds[K]) : null;
  } catch {
    return null;
  }
}

export async function writeCache<K extends Kind>(
  kind: K,
  userId: string,
  value: Kinds[K],
): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(kind, userId), JSON.stringify(value));
  } catch {
    // Storage full or unavailable: offline just has less to show.
  }
}

/** Drop every cached read for this user. */
export async function clearCaches(userId: string): Promise<void> {
  try {
    await AsyncStorage.multiRemove(KINDS.map((k) => cacheKey(k, userId)));
  } catch {
    // Best-effort; nothing else to do.
  }
}
