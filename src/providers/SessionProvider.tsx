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
import { unregisterPush } from "@/push/register";
import { cancelRevisionNudges } from "@/push/revisionNudge";
import { AUTH_STORAGE_KEY, supabase } from "@/supabase/client";
import { secureStorage } from "@/supabase/secureStorage";

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
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setSession(data.session);
        await syncProfile(data.session?.user.id ?? null);
      } catch (e) {
        // A keychain read failure must not strand the app behind the splash;
        // fall through to the signed-out gate.
        console.warn("Session restore failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (cancelled) return;
      const nextId = next?.user.id ?? null;
      // The revision nudges belong to the member who was signed in. Every
      // way out drops them, not only the Sign out button: a revoked or
      // expired refresh token ends the session here too, and the tabs that
      // would otherwise cancel them unmount. Best-effort and local.
      if (activeUserId.current && nextId !== activeUserId.current) {
        void cancelRevisionNudges();
      }
      // TOKEN_REFRESHED for the same user does not change the profile.
      if (event === "TOKEN_REFRESHED" && nextId === activeUserId.current) {
        setSession(next);
        return;
      }
      // Everything else might (sign-in, sign-out, user switched,
      // USER_UPDATED): load the profile first and publish both together, so
      // the gate never sees a signed-in user with a null profile and flashes
      // onboarding at an already-onboarded member for one network roundtrip.
      // The web awaited getAuth() (user + profile) before rendering anything.
      // Sign-out resolves at once (no profile to load), so it still flips
      // the gate immediately.
      void syncProfile(nextId).then(() => {
        if (cancelled || activeUserId.current !== nextId) return;
        setSession(next);
      });
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
    // This device's push row must go while the session can still delete it
    // (RLS blocks the delete once signed out). Best-effort with a short
    // timeout: leaving never waits on the network. The enabled flag stays, so
    // signing back in re-registers silently (docs/PHASE3.md).
    const userId = activeUserId.current;
    if (userId) {
      await Promise.race([
        // The revision nudges are this member's, scheduled on this device
        // (docs/DECISIONS.md "Revision plan"): the next person to sign in
        // must not get them. Local, so it is quick.
        Promise.all([unregisterPush(userId, { keepFlag: true }), cancelRevisionNudges()]),
        new Promise((r) => setTimeout(r, 2500)),
      ]).catch(() => {});
    }
    // Local scope: drop this device's session and tokens. The gate flips as
    // soon as onAuthStateChange reports SIGNED_OUT.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      // supabase-js bails before clearing storage when the current session
      // cannot be loaded or refreshed. The user asked to leave, so clear the
      // stored session ourselves and flip the gate.
      console.warn("Sign out did not complete cleanly", error);
      await secureStorage.removeItem(AUTH_STORAGE_KEY);
      activeUserId.current = null;
      setProfile(null);
      setSession(null);
    }
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
