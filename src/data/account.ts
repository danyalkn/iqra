import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from "@supabase/supabase-js";

import { supabase } from "@/supabase/client";

/**
 * Hard-deletes the signed-in member's account.
 *
 * Mirrors reference/web-pwa/app/api/account/route.ts: a server-side call
 * removes the auth user with the service-role key, and because every user FK
 * is ON DELETE CASCADE that wipes the profile, logs, messages, nudges,
 * reminders (daily and one-time) and push subscriptions in one go. Native
 * has no Next route, so the same work lives in the `delete-account` edge
 * function (supabase/functions/delete-account, deployed 2026-10-16), which
 * answers { ok: true } or { error } with a non-2xx status.
 */
const GENERIC = "Couldn’t delete your account.";

export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke("delete-account", { method: "POST" });
  if (!error) return;
  throw new Error(await describe(error));
}

/** Turn a functions-js failure into one sentence the sheet can show. */
async function describe(error: unknown): Promise<string> {
  // FunctionsHttpError (non-2xx) and FunctionsRelayError (x-relay-error)
  // both carry the fetch Response as `context`.
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const res = error.context as Response | undefined;
    // The function answers { error } like the web route did; prefer that.
    try {
      const body: unknown = await res?.json();
      if (body && typeof body === "object") {
        const msg = (body as { error?: unknown }).error;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    } catch {
      // Not JSON; fall through to the generic line.
    }
    return GENERIC;
  }
  // FunctionsFetchError: the request never reached the relay (offline, DNS).
  if (error instanceof FunctionsFetchError) return GENERIC;
  return error instanceof Error && error.message ? error.message : GENERIC;
}

/**
 * Sets a new password for the signed-in member: the reset for a forgotten
 * password (owner decision 2026-10-17, docs/DECISIONS.md § Auth). There is no
 * email service, so the live session is the proof of identity and no old
 * password or emailed link is asked for. Signed-out members still go to the
 * owner (supabase/admin_examples.sql).
 */
export async function setPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (!error) return;
  // "Secure password change" in the Supabase dashboard would demand an
  // emailed nonce for sessions older than 24h, which nobody here can receive.
  if (error.code === "reauthentication_needed") {
    throw new Error("Sign out and back in, then try again. If you can't, ask the group owner.");
  }
  throw new Error(error.message || "Couldn’t update your password.");
}
