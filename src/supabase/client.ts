import { createClient, type Session } from "@supabase/supabase-js";
import { AppState } from "react-native";

import { secureStorage } from "./secureStorage";

/**
 * The one Supabase client for the app (mirrors
 * reference/web-pwa/lib/supabase/client.ts). Lives outside src/lib because it
 * needs react-native's AppState; src/lib stays DOM- and RN-free so the web
 * repo can keep mirroring it.
 *
 * Same project and publishable key as the web PWA, so the same accounts work.
 * EXPO_PUBLIC_* values are inlined into the JS bundle at build time.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** True once the public env vars are filled in (copy .env.example to .env). */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/** Where supabase-js keeps the session; SessionProvider clears it directly
 *  if a sign-out cannot complete through the API. */
export const AUTH_STORAGE_KEY = "iqra-auth";

/**
 * The session supabase-js stored, read straight from the keychain with no
 * network. Offline with an expired access token supabase-js keeps it there
 * but its getSession() reports none (and first spends up to half a minute
 * retrying the refresh), so the gate and the headless log path use this to
 * know who is signed in. Only a fully formed session counts.
 */
export async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await secureStorage.getItem(AUTH_STORAGE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object") return null;
    const s = v as Partial<Session>;
    if (
      typeof s.access_token === "string" &&
      typeof s.refresh_token === "string" &&
      typeof s.user?.id === "string"
    ) {
      return s as Session;
    }
  } catch {
    // Unreadable: treat as signed out.
  }
  return null;
}

/**
 * True while a member is signed in on this device, including the offline
 * case where supabase-js keeps the stored session but reports none because
 * its access token expired and could not be refreshed (SessionProvider).
 */
let signedIn = false;

/** SessionProvider: a stored session is being used while its refresh waits
 *  for a connection. */
export function markSignedIn(): void {
  signedIn = true;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * fetch for every Supabase request. With no usable session supabase-js
 * sends the publishable key as the bearer, and RLS answers such a read with
 * an empty list and no error: Today would read "nothing logged" and the
 * outbox a refusal. That happens offline with an expired token and for up
 * to a minute after the connection returns (supabase-js caches a failed
 * refresh). This app has no signed-out data reads, so while a member is
 * signed in such a request is failed here as if the network had dropped,
 * and every caller takes its offline path (docs/NEXT-SESSION.md).
 */
const guardedFetch: typeof fetch = async (input, init) => {
  if (signedIn && requestUrl(input).includes("/rest/v1/")) {
    const auth = new Headers(init?.headers).get("Authorization");
    if (auth === `Bearer ${SUPABASE_KEY}`) {
      throw new TypeError("Network request failed (session not refreshed yet)");
    }
  }
  return fetch(input, init);
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: guardedFetch },
  auth: {
    storage: secureStorage,
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    // Native has no URL to read a session from.
    detectSessionInUrl: false,
  },
  realtime: {
    // Ported from the web client: when a heartbeat reports the socket dead
    // (the app was suspended), reconnect now instead of waiting for backoff.
    // The web client's `worker: true` is browser-only and is dropped.
    heartbeatCallback: (status: string) => {
      if (status === "timeout" || status === "disconnected") {
        supabase.realtime.connect();
      }
    },
  },
});

supabase.auth.onAuthStateChange((event, session) => {
  if (session) signedIn = true;
  else if (event === "SIGNED_OUT") signedIn = false;
});

// The token refresh timer only makes sense while the app is in the
// foreground (Expo's Supabase guide). Stopping it in the background also
// avoids a refresh racing a push-triggered launch.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
// A launch straight into the foreground sends no "change", and the timer is
// what refreshes a session that expired offline once the connection returns.
if (AppState.currentState === "active") supabase.auth.startAutoRefresh();

// Realtime auth: supabase-js already forwards SIGNED_IN / TOKEN_REFRESHED /
// SIGNED_OUT to realtime.setAuth() internally, so the channel JWT follows the
// session with no extra listener here. Chat (Phase 2) still re-subscribes on
// every (re)join per docs/DECISIONS.md.
