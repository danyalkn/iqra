// Iqra - delete-account Edge Function
// Hard-deletes the calling member's account. Port of the PWA's
// app/api/account/route.ts (a Next route with the service-role key); the
// native app has no server of its own, so the same two steps live here:
// prove who is calling from their JWT, then remove the auth user with the
// admin API. Every user FK is ON DELETE CASCADE, so that wipes the profile,
// group memberships, logs, messages, reactions, chat reads, nudges, daily
// and one-time reminders and push subscriptions in one go.
//
// Deploy:  supabase functions deploy delete-account
//          (keep JWT verification ON: the gateway rejects anonymous calls
//          before this code runs, and getUser() below checks the token again)
// Secrets: none beyond the injected SUPABASE_URL, SUPABASE_ANON_KEY and
//          SUPABASE_SERVICE_ROLE_KEY.
//
// The app (src/data/account.ts) invokes it with the member's session and
// maps `{ error }` to the sheet; a 2xx `{ ok: true }` is followed by a local
// sign-out.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "Not signed in" }, 401);
  }

  // Who is asking: a client bound to the caller's token, so getUser() is the
  // caller or nobody. A service-role token must not be able to delete an
  // arbitrary user through this door either, hence no role shortcut.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await asCaller.auth.getUser();
  if (userError || !user) {
    return json({ error: "Not signed in" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("delete-account failed", user.id, error.message);
    return json({ error: error.message }, 500);
  }

  return json({ ok: true });
});
