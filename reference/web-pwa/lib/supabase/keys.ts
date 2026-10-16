/**
 * Central Supabase key resolution. Supports both the classic `anon` key name
 * and Supabase's newer `publishable` key name (sb_publishable_…). Both env
 * references are written literally so Next.js inlines them into the client
 * bundle at build time.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";
