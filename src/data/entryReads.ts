/**
 * Native-side reads that keep the error. The shared lib/data helpers (kept
 * verbatim with the web) collapse a failed request into [], so a dropped
 * connection would look like "never logged anything": Today would show an
 * empty day, and a notification action would continue from nothing and
 * reset the member's bookmark. The web could live with that: its server
 * re-ran the queries on every visit and its client refetch checked `data &&`.
 * Same select, filters and order as getMyRecentEntries / getMyDayReminders
 * in src/lib/data.ts. Lives outside src/lib (imports the client).
 */

import type { EntryType } from "@/lib/entries";
import type { DayReminder, LogRow } from "@/lib/types";
import { supabase } from "@/supabase/client";

export async function fetchMyRecentEntries(
  groupId: string,
  userId: string,
  sinceDays = 120,
): Promise<{ rows: LogRow[] | null; error: boolean }> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false });
  if (error) return { rows: null, error: true };
  return { rows: (data as LogRow[] | null) ?? [], error: false };
}

export async function fetchMyDayReminders(
  userId: string,
  fromYmd: string,
  toYmd: string,
): Promise<{ rows: DayReminder[] | null; error: boolean }> {
  const { data, error } = await supabase
    .from("day_reminders")
    .select("*")
    .eq("user_id", userId)
    .gte("remind_on", fromYmd)
    .lte("remind_on", toYmd)
    .order("remind_on", { ascending: true })
    .order("time", { ascending: true });
  if (error) return { rows: null, error: true };
  return { rows: (data as DayReminder[] | null) ?? [], error: false };
}

/** One hifz entry as the revision plan needs it. */
export type HifzHistoryRow = Pick<LogRow, "id" | "entry_type" | "juz" | "logged_at">;

const HIFZ_TYPES: EntryType[] = ["sabak", "sabak_para", "dor"];

/**
 * Every Sabak, Sabak Para and Dhor entry this member ever logged, with only
 * the fields the revision plan reads (src/lib/revisionPlan.ts). Unwindowed on
 * purpose: Today's 120-day read would let a juz last touched before then drop
 * out of the plan instead of being due. Small (a few hundred rows at most).
 * Native-only; the web has no revision plan.
 */
export async function fetchMyHifzHistory(
  userId: string,
): Promise<{ rows: HifzHistoryRow[] | null; error: boolean }> {
  const { data, error } = await supabase
    .from("log_entries")
    .select("id, entry_type, juz, logged_at")
    .eq("user_id", userId)
    .in("entry_type", HIFZ_TYPES)
    .order("logged_at", { ascending: false });
  if (error) return { rows: null, error: true };
  return { rows: (data as HifzHistoryRow[] | null) ?? [], error: false };
}
