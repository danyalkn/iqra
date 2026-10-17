/**
 * Client-side writes for log entries (insert, edit, delete), shared by Today,
 * the Journal and the notification actions (src/push) so every path behaves
 * identically, including the mushaf retry guard.
 *
 * Lives outside src/lib because it imports the Supabase client (src/lib
 * stays DOM- and RN-free). Ported from reference/web-pwa/entryWrites.ts.
 */

import type { LogRow, NewEntry } from "@/lib/types";
import { supabase } from "@/supabase/client";

/** True when a write failed only because the mushaf column isn't in the schema
 *  yet (migration not applied). Writes then retry without it, so a pending
 *  migration can never block logging. (DECISIONS: legacy guard, droppable once
 *  the native app is the only client.) */
export function isMissingMushaf(err: { message?: string } | null): boolean {
  return !!err && /mushaf/i.test(err.message ?? "");
}

/** Create an entry for `userId` in `groupId`. `logged_at` is sent only when
 *  the payload backdates; otherwise the server stamps now. */
export async function insertEntry(
  userId: string,
  groupId: string,
  payload: NewEntry,
): Promise<{ row: LogRow | null; error: string | null }> {
  const base: Record<string, unknown> = {
    user_id: userId,
    group_id: groupId,
    ...(payload.logged_at ? { logged_at: payload.logged_at } : {}),
    entry_type: payload.entry_type,
    from_ref: payload.from_ref,
    to_ref: payload.to_ref,
    amount: payload.amount,
    unit: payload.unit,
    juz: payload.juz,
    part: payload.part,
    notes: payload.notes,
  };
  let res = await supabase
    .from("log_entries")
    .insert(payload.mushaf != null ? { ...base, mushaf: payload.mushaf } : base)
    .select("*")
    .single();
  // Retry without mushaf if that column isn't in the schema yet.
  if (isMissingMushaf(res.error) && payload.mushaf != null) {
    res = await supabase.from("log_entries").insert(base).select("*").single();
  }
  if (res.error || !res.data) {
    return { row: null, error: res.error?.message ?? "Couldn’t save that entry. Try again." };
  }
  return { row: res.data as LogRow, error: null };
}

/** Save edits to an entry. `logged_at` is never changed by an edit. */
export async function updateEntry(
  id: string,
  payload: NewEntry,
): Promise<{ row: LogRow | null; error: string | null }> {
  const base: Record<string, unknown> = {
    entry_type: payload.entry_type,
    from_ref: payload.from_ref,
    to_ref: payload.to_ref,
    amount: payload.amount,
    unit: payload.unit,
    juz: payload.juz,
    part: payload.part,
    notes: payload.notes,
  };
  let res = await supabase
    .from("log_entries")
    .update(payload.mushaf != null ? { ...base, mushaf: payload.mushaf } : base)
    .eq("id", id)
    .select("*")
    .single();
  // Retry without mushaf if that column isn't in the schema yet.
  if (isMissingMushaf(res.error) && payload.mushaf != null) {
    res = await supabase
      .from("log_entries")
      .update(base)
      .eq("id", id)
      .select("*")
      .single();
  }
  if (res.error || !res.data) {
    return { row: null, error: res.error?.message ?? "Couldn’t save your changes. Try again." };
  }
  return { row: res.data as LogRow, error: null };
}

/** Delete an entry. Returns an error message, or null on success. */
export async function deleteEntry(id: string): Promise<string | null> {
  const { error } = await supabase.from("log_entries").delete().eq("id", id);
  return error ? "Couldn’t delete that entry." : null;
}

/* Today keeps the entries it loaded while its tab is in the background. When
 * the Journal changes an entry it leaves this flag, and Today checks it when
 * it regains focus and refetches if set. The web kept the flag in
 * sessionStorage for pages restored from the router cache; native tabs stay
 * mounted, so a module-level boolean (per app launch) is the same thing. */
let entriesChanged = false;

export function markEntriesChanged(): void {
  entriesChanged = true;
}

/** True once after the Journal changed something (the flag is cleared). */
export function takeEntriesChanged(): boolean {
  const changed = entriesChanged;
  entriesChanged = false;
  return changed;
}
