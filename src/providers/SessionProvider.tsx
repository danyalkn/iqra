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

import { fetchProfile } from "@/data/profile";
import { TIMED_OUT, withTimeout } from "@/data/timeout";
import { isOnboarded as computeOnboarded, type Profile } from "@/lib/auth";
import { unregisterPush } from "@/push/register";
import { cancelRevisionNudges } from "@/push/revisionNudge";
import { clearCaches, readCache } from "@/storage/cache";
import { clearOutbox } from "@/storage/outbox";
import {
  AUTH_STORAGE_KEY,
  markSignedIn,
  markSignedOut,
  readStoredSession,
  supabase,
} from "@/supabase/client";
import { secureStorage } from "@/supabase/secureStorage";

/**
 * Who is signed in and their profile (ported from reference/web-pwa/auth.ts,
 * where Next re-read it per request). Native keeps it in memory, refreshes it
 * on every auth event, and exposes refreshProfile() for screens that write
 * to `profiles` (onboarding, Settings) so the gate and headers update at once.
 *
 * Offline (docs/NEXT-SESSION.md "Offline logging"): the member stays signed
 * in. supabase-js reports no session when its access token expired and the
 * refresh cannot reach the server (it keeps the stored one and refreshes it
 * once the connection returns, which arrives here as TOKEN_REFRESHED), so
 * the stored session stands in until then. The profile comes from its last
 * good copy first and is refreshed behind it, so neither the splash nor the
 * gate waits on the network.
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

/** How long the splash waits for supabase-js before using the stored
 *  session (offline it retries a refresh for up to half a minute). */
const SESSION_WAIT_MS = 2500;

/** How long the gate waits for a profile it has no saved copy of. Long
 *  enough for a slow sign-in; offline with an expired token the read would
 *  otherwise take over half a minute to fail. A profile that lands later
 *  is still applied. */
const PROFILE_WAIT_MS = 8000;

/** How long Sign out waits for supabase-js, which first retries a token
 *  refresh offline before giving up and leaving the session in place. */
const SIGN_OUT_WAIT_MS = 3000;

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
  // Bumped by every SIGNED_OUT, so a launch read of the stored session that
  // was in flight when the session died is not applied after it.
  const signOutEpoch = useRef(0);

  // `preferCache`: publish the last good copy at once and refresh it behind
  // (launch, auth events); without it, wait for the server (a screen that
  // just wrote to `profiles`).
  const syncProfile = useCallback(async (userId: string | null, preferCache = true) => {
    activeUserId.current = userId;
    if (!userId) {
      setProfile(null);
      return null;
    }
    const cached = preferCache ? await readCache("profile", userId) : null;
    if (activeUserId.current !== userId) return null;
    if (cached) {
      setProfile(cached);
      void fetchProfile(userId).then((fresh) => {
        if (fresh !== undefined && activeUserId.current === userId) setProfile(fresh);
      });
      return cached;
    }
    const request = fetchProfile(userId);
    const res = await withTimeout(request, PROFILE_WAIT_MS);
    if (activeUserId.current !== userId) return null;
    if (res === TIMED_OUT) {
      void request.then((late) => {
        if (late !== undefined && activeUserId.current === userId) setProfile(late);
      });
    }
    const fresh = res === TIMED_OUT ? undefined : res;
    // A failed read with nothing cached: no better answer than none.
    const next = fresh ?? (await readCache("profile", userId));
    if (activeUserId.current !== userId) return null;
    setProfile(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Initial read of the persisted session (secure storage), then the
    // profile, then let the gate render. onAuthStateChange also fires
    // INITIAL_SESSION, but awaiting getSession() here keeps `loading`
    // honest even if that event is delayed. Offline with an expired token
    // getSession() answers late or not at all; the stored session is then
    // used as is (see the header).
    (async () => {
      try {
        const epoch = signOutEpoch.current;
        const res = await withTimeout(supabase.auth.getSession(), SESSION_WAIT_MS);
        if (cancelled) return;
        let initial = res === TIMED_OUT ? null : res.data.session;
        if (!initial) {
          // Still stored means supabase-js kept it for a later refresh (a
          // dead refresh token is removed from storage at once).
          initial = await readStoredSession();
          if (cancelled) return;
          if (signOutEpoch.current !== epoch) initial = null;
          if (initial) markSignedIn();
        }
        setSession(initial);
        await syncProfile(initial?.user.id ?? null);
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
      // The launch read above covers it, and offline this event carries no
      // session for a member who is still signed in.
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") signOutEpoch.current += 1;
      const nextId = next?.user.id ?? null;
      // The revision nudges belong to the member who was signed in. Every
      // way out drops them, not only the Sign out button: a revoked or
      // expired refresh token ends the session here too, and the tabs that
      // would otherwise cancel them unmount. Best-effort and local.
      if (activeUserId.current && nextId !== activeUserId.current) {
        void cancelRevisionNudges();
        // Their cached reads are private; the outbox stays, keyed to them,
        // so signing back in still sends what they logged (it can never
        // sync into another account). A deliberate sign-out clears both.
        void clearCaches(activeUserId.current);
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
    () => syncProfile(activeUserId.current, false),
    [syncProfile],
  );

  // Callers with unsynced entries ask the member first (Profile); this
  // discards them along with the cached reads.
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
        Promise.all([
          unregisterPush(userId, { keepFlag: true }),
          cancelRevisionNudges(),
          // Local, quick: the outbox (the member chose to discard it) and
          // every cached read (docs/NEXT-SESSION.md "Privacy").
          clearOutbox(userId),
          clearCaches(userId),
        ]),
        new Promise((r) => setTimeout(r, 2500)),
      ]).catch(() => {});
    }
    // Local scope: drop this device's session and tokens. The gate flips as
    // soon as onAuthStateChange reports SIGNED_OUT.
    const res = await withTimeout(supabase.auth.signOut({ scope: "local" }), SIGN_OUT_WAIT_MS);
    const error = res === TIMED_OUT ? new Error("sign-out timed out") : res.error;
    if (error) {
      // supabase-js bails before clearing storage when the current session
      // cannot be loaded or refreshed. The user asked to leave, so clear the
      // stored session ourselves and flip the gate.
      console.warn("Sign out did not complete cleanly", error);
      await secureStorage.removeItem(AUTH_STORAGE_KEY);
      markSignedOut();
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
