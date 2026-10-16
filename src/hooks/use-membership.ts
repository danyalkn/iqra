import { useCallback, useEffect, useState } from "react";

import { getMyMembership } from "@/lib/data";
import type { Membership } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

/**
 * The signed-in member's circle. The web read it per request in every page
 * (`getMyMembership()`); native reads it once per user and shares the answer
 * across Today, Journal, Profile, Feed, Chat and Stats, because membership
 * only changes when the owner edits it in SQL. `refresh()` re-reads it.
 *
 *   undefined -> still loading
 *   null      -> signed in but not in a circle yet (Placeholder states)
 */
const cache = new Map<string, Membership | null>();
const inflight = new Map<string, Promise<Membership | null>>();

function load(userId: string, force = false): Promise<Membership | null> {
  if (!force && cache.has(userId)) return Promise.resolve(cache.get(userId) ?? null);
  const pending = inflight.get(userId);
  if (pending && !force) return pending;
  const p = getMyMembership(supabase)
    .then((m) => {
      cache.set(userId, m);
      return m;
    })
    .finally(() => inflight.delete(userId));
  inflight.set(userId, p);
  return p;
}

export function useMembership(): {
  membership: Membership | null | undefined;
  refresh: () => Promise<Membership | null>;
} {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [membership, setMembership] = useState<Membership | null | undefined>(() =>
    userId && cache.has(userId) ? (cache.get(userId) ?? null) : undefined,
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    load(userId).then((m) => {
      if (!cancelled) setMembership(m);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return null;
    const m = await load(userId, true);
    setMembership(m);
    return m;
  }, [userId]);

  return { membership, refresh };
}
