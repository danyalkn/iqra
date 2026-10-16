import { createClient } from "@supabase/supabase-js";
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

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: secureStorage,
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

// Realtime auth: supabase-js already forwards SIGNED_IN / TOKEN_REFRESHED /
// SIGNED_OUT to realtime.setAuth() internally, so the channel JWT follows the
// session with no extra listener here. Chat (Phase 2) still re-subscribes on
// every (re)join per docs/DECISIONS.md.
