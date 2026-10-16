import type { Mode } from "@/lib/entries";
import type { MushafId } from "@/lib/mushaf";

/** A row of `profiles` (ported from reference/web-pwa/auth.ts). */
export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  /** Deprecated: reminders live in the `reminders` table. Never read. */
  reminder_time: string | null;
  mode: Mode;
  notify_chat: boolean | null;
  mushaf: MushafId | null;
  created_at: string;
};

/** A profile counts as onboarded once it has a name and a mode. */
export function isOnboarded(profile: Profile | null): boolean {
  return Boolean(profile && profile.display_name && profile.mode);
}
