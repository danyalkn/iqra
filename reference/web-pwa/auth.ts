import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Mode } from "@/lib/entries";
import type { MushafId } from "@/lib/mushaf";

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  reminder_time: string | null;
  mode: Mode;
  notify_chat: boolean | null;
  mushaf: MushafId | null;
  created_at: string;
};

/** Current user + their profile, deduped per request. */
export const getAuth = cache(async (): Promise<{
  user: { id: string; email: string | null } | null;
  profile: Profile | null;
}> => {
  if (!isSupabaseConfigured()) return { user: null, profile: null };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: (profile as Profile | null) ?? null,
  };
});

/** A profile counts as onboarded once it has a name and a mode. */
export function isOnboarded(profile: Profile | null): boolean {
  return Boolean(profile && profile.display_name && profile.mode);
}
