import type { Profile } from "@/lib/auth";
import { writeCache } from "@/storage/cache";
import { supabase } from "@/supabase/client";

/** The member's profile from the server, cached for offline launches and
 *  the headless log path. undefined when the read failed (no connection):
 *  the caller keeps or falls back to what it has; null = no profile row. */
export async function fetchProfile(userId: string): Promise<Profile | null | undefined> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) return undefined;
  const profile = (data as Profile | null) ?? null;
  if (profile) void writeCache("profile", userId, profile);
  return profile;
}
