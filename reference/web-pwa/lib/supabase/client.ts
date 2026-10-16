import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./keys";

/**
 * Browser-side Supabase client (singleton - @supabase/ssr caches it, so every
 * createClient() call shares one auth session and one realtime socket).
 *
 * Realtime hardening for a PWA that gets backgrounded/suspended:
 * - worker: heartbeats run in a Web Worker so background tab-timer throttling
 *   can't starve them (Supabase's recommendation for backgrounded apps).
 * - heartbeatCallback: when a heartbeat reports the socket dead, kick a
 *   reconnect immediately instead of waiting for the next backoff cycle.
 */
let sharedClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  const client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    realtime: {
      worker: true,
      heartbeatCallback: (status: string) => {
        if (status === "timeout" || status === "disconnected") {
          sharedClient?.realtime.connect();
        }
      },
    },
  });
  sharedClient = client;
  return client;
}
