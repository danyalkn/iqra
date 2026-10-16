import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./keys";

/** True once the Supabase env vars are filled in. Lets the app render a
 *  friendly "not configured yet" state instead of crashing pre-setup. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
