import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./keys";
import { isSupabaseConfigured } from "./config";

/**
 * Refreshes the Supabase auth session on every request and keeps the auth
 * cookies in sync between the request and response. Routing/redirect rules
 * are intentionally left out here - they live in middleware.ts so this stays
 * a pure session-refresh helper.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Until Supabase is configured (env vars filled in), skip session refresh so
  // the app still runs locally. Auth flows are gated on these vars elsewhere.
  if (!isSupabaseConfigured()) {
    return supabaseResponse;
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and getUser().
  // getUser() revalidates the token and triggers cookie refresh.
  await supabase.auth.getUser();

  return supabaseResponse;
}
