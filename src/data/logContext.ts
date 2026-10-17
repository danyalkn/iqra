import type { Profile } from "@/lib/auth";
import { getMyMembership } from "@/lib/data";
import { withPending } from "@/lib/outbox";
import type { LogRow } from "@/lib/types";
import { readCache, writeCache } from "@/storage/cache";
import { loadOutbox } from "@/storage/outbox";
import { supabase } from "@/supabase/client";

import { fetchMyRecentEntries } from "./entryReads";
import { fetchProfile } from "./profile";
import { TIMED_OUT, withTimeout } from "./timeout";

/**
 * What a one-tap log from a notification button needs to build the entry
 * the sheet would have saved (docs/NEXT-SESSION.md "Entry building
 * offline"): the profile (mode, mushaf, timezone), the circle, and the
 * member's recent entries to continue from. Each comes from the server when
 * it answers within a few seconds, else from the last copy Today or the
 * session saved, and the entries waiting in the outbox are laid over the
 * recent rows so "continue from" and the streak count them too.
 *
 * Null when a piece has never been loaded on this device: continuing from
 * nothing would reset the bookmark or restart sabak at Juz 1, so the caller
 * sends the member to the sheet instead.
 */

export type LogContext = {
  profile: Profile;
  groupId: string;
  /** Server (or cached) rows plus the outbox's waiting entries, newest first. */
  recent: LogRow[];
  /** True when any piece came from a saved copy. */
  fromCache: boolean;
};

/** A background launch may have only seconds before iOS suspends it, and
 *  the entry is safe only once it is queued. With saved copies on the
 *  device, fresh rows get a short look; without them there is nothing to
 *  fall back on, so the reads get longer. */
const QUICK_MS = 1500;
const READ_MS = 4000;

export async function logContext(userId: string): Promise<LogContext | null> {
  const [savedProfile, savedMembership, savedToday, outbox] = await Promise.all([
    readCache("profile", userId),
    readCache("membership", userId),
    readCache("today", userId),
    loadOutbox(userId),
  ]);
  // The circle almost never changes, so the saved one lets the entries read
  // start alongside the others.
  const groupGuess = savedMembership?.m?.group_id ?? null;
  const wait = savedProfile && groupGuess && savedToday ? QUICK_MS : READ_MS;
  const [profileRes, membershipRes, guessedRecent] = await Promise.all([
    withTimeout(fetchProfile(userId), wait),
    withTimeout(getMyMembership(supabase), wait),
    groupGuess ? withTimeout(fetchMyRecentEntries(groupGuess, userId), wait) : null,
  ]);

  let fromCache = false;
  let profile: Profile | null = null;
  if (profileRes !== TIMED_OUT && profileRes !== undefined) profile = profileRes;
  else {
    profile = savedProfile;
    fromCache = true;
  }

  let groupId: string | null = null;
  if (membershipRes !== TIMED_OUT) {
    groupId = membershipRes?.group_id ?? null;
    void writeCache("membership", userId, { m: membershipRes });
  } else {
    groupId = groupGuess;
    fromCache = true;
  }
  if (!profile || !groupId) return null;

  let rows: LogRow[] | null = null;
  const recentRes =
    guessedRecent && groupId === groupGuess
      ? guessedRecent
      : await withTimeout(fetchMyRecentEntries(groupId, userId), READ_MS);
  if (recentRes !== TIMED_OUT && recentRes && !recentRes.error && recentRes.rows) {
    rows = recentRes.rows;
  } else if (savedToday && groupId === groupGuess) {
    rows = savedToday.entries;
    fromCache = true;
  }
  if (!rows) return null;

  const mine = outbox.filter((i) => i.groupId === groupId);
  return { profile, groupId, recent: withPending(rows, mine), fromCache };
}
