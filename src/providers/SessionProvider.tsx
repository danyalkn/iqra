import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { isOnboarded as computeOnboarded, type Profile } from "@/lib/auth";
import { supabase } from "@/supabase/client";

/**
 * Who is signed in and their profile (ported from reference/web-pwa/auth.ts,
 * where Next re-read it per request). Native keeps it in memory, refreshes it
 * on every auth event, and exposes refreshProfile() for screens that write
 * to `profiles` (onboarding, Settings) so the gate and headers update at once.
 */
type SessionContextValue = {
  /** True until the persisted session has been read from secure storage. */
  loading: boolean;
  session: Session | null;
  user: { id: string; email: string | null } | null;
  profile: Profile | null;
  isOnboarded: boolean;
  refreshProfile: () => Promise<Profile | null>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

function toUser(u: User | null | undefined): SessionContextValue["user"] {
  return u ? { id: u.id, email: u.email ?? null } : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Guards against a slow profile fetch for user A landing after user B
  // signed in (or after sign-out).
  const activeUserId = useRef<string | null>(null);

  const syncProfile = useCallback(async (userId: string | null) => {
    activeUserId.current = userId;
    if (!userId) {
      setProfile(null);
      return null;
    }
    const next = await loadProfile(userId);
    if (activeUserId.current !== userId) return null;
    setProfile(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Initial read of the persisted session (secure storage), then the
    // profile, then let the gate render. onAuthStateChange also fires
    // INITIAL_SESSION, but awaiting getSession() here keeps `loading`
    // honest even if that event is delayed.
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      await syncProfile(data.session?.user.id ?? null);
      if (!cancelled) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (cancelled) return;
      setSession(next);
      const nextId = next?.user.id ?? null;
      // TOKEN_REFRESHED does not change the profile; everything else might
      // (sign-in, sign-out, user switched, USER_UPDATED).
      if (event !== "TOKEN_REFRESHED" || nextId !== activeUserId.current) {
        void syncProfile(nextId);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [syncProfile]);

  const refreshProfile = useCallback(
    () => syncProfile(activeUserId.current),
    [syncProfile],
  );

  const signOut = useCallback(async () => {
    // Local scope: drop this device's session and tokens. The gate flips as
    // soon as onAuthStateChange reports SIGNED_OUT.
    await supabase.auth.signOut({ scope: "local" });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      loading,
      session,
      user: toUser(session?.user),
      profile,
      isOnboarded: computeOnboarded(profile),
      refreshProfile,
      signOut,
    }),
    [loading, session, profile, refreshProfile, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
