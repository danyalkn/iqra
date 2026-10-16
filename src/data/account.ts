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
 * function, which Phase 3 deploys (docs/HANDOFF.md Phase 3). Until it exists
 * the relay answers 404 and this surfaces a readable "not yet" message
 * instead of a raw HTTP error.
 */
const NOT_AVAILABLE = "Account deletion isn’t available in this build yet.";
const GENERIC = "Couldn’t delete your account.";

export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke("delete-account", { method: "POST" });
  if (!error) return;
  throw new Error(await describe(error));
}

/** Turn a functions-js failure into one sentence the sheet can show. */
async function describe(error: unknown): Promise<string> {
  // FunctionsHttpError (non-2xx) and FunctionsRelayError (x-relay-error)
  // both carry the fetch Response as `context`; a function that is not
  // deployed yet comes back as a 404 from either path.
  if (error instanceof FunctionsHttpError || error instanceof FunctionsRelayError) {
    const res = error.context as Response | undefined;
    if (res?.status === 404) return NOT_AVAILABLE;
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
