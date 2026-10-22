import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { getMyMembership } from "@/lib/data";
import type { Membership } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { readCache, writeCache } from "@/storage/cache";
import { supabase } from "@/supabase/client";

/**
 * The signed-in member's circle. The web read it per request in every page
 * (`getMyMembership()`); native reads it once per user and shares the answer
 * across Today, Journal, Profile, Feed, Chat and Stats, because membership
 * only changes when the owner edits it in SQL. `refresh()` re-reads it.
 *
 *   undefined -> still loading, or the read failed (see `failed`)
 *   null      -> signed in but not in a circle yet (Placeholder states)
 *
 * Only an answer is cached. A failed read (dead network at launch, expired
 * token) stays `undefined` with `failed` set, is retried when the app returns
 * to the foreground and whenever a screen mounts or calls `refresh()`, and
 * never shows "not in a circle" to a member who is in one (Phase 2 review).
 *
 * Offline (docs/NEXT-SESSION.md): the last answer is also kept on disk and
 * shown while the network read is out (offline that read can take half a
 * minute to fail), so Today opens on its saved data at once. The disk copy
 * never counts as an answer here: the read is still retried as above.
 */
const cache = new Map<string, Membership | null>();
const inflight = new Map<string, Promise<Membership | null>>();

function load(userId: string, force = false): Promise<Membership | null> {
  if (!force && cache.has(userId)) return Promise.resolve(cache.get(userId) ?? null);
  const pending = inflight.get(userId);
  if (pending && !force) return pending;
  const p = getMyMembership(supabase, userId)
    .then((m) => {
      cache.set(userId, m);
      void writeCache("membership", userId, { m });
      return m;
    })
    .finally(() => inflight.delete(userId));
  inflight.set(userId, p);
  return p;
}

export function useMembership(): {
  membership: Membership | null | undefined;
  /** True while the last read failed and no answer is cached. */
  failed: boolean;
  refresh: () => Promise<Membership | null>;
} {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [membership, setMembership] = useState<Membership | null | undefined>(() =>
    userId && cache.has(userId) ? (cache.get(userId) ?? null) : undefined,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    if (!cache.has(userId)) {
      void readCache("membership", userId).then((saved) => {
        if (cancelled || !saved || cache.has(userId)) return;
        setMembership((cur) => (cur === undefined ? saved.m : cur));
      });
    }
    const run = () =>
      load(userId).then(
        (m) => {
          if (cancelled) return;
          setMembership(m);
          setFailed(false);
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    void run();
    // The OS may have killed the sockets while the app was away; a read
    // that never landed gets another go on return.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && !cache.has(userId)) void run();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return null;
    try {
      const m = await load(userId, true);
      setMembership(m);
      setFailed(false);
      return m;
    } catch (e) {
      setFailed(true);
      throw e;
    }
  }, [userId]);

  return { membership, failed, refresh };
}
