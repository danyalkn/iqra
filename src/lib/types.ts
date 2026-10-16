import type { EntryType, Unit } from "@/lib/entries";
import type { MushafId } from "@/lib/mushaf";

export type LogRow = {
  id: string;
  user_id: string;
  group_id: string;
  entry_type: EntryType;
  from_ref: string | null;
  to_ref: string | null;
  amount: number | null;
  unit: Unit | null;
  juz: number | null;
  part: number | null;
  pages_equiv: number | null;
  mushaf: MushafId | null;
  notes: string | null;
  logged_at: string;
};

export type Membership = {
  group_id: string;
  group_name: string;
  role: string;
};

export type GroupMember = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

export type Message = {
  id: string;
  group_id: string;
  user_id: string;
  body: string;
  mentions: string[];
  reply_to: string | null;
  created_at: string;
};

/** A member's chat read frontier: the newest message time they have seen. */
export type ChatRead = {
  user_id: string;
  last_read_at: string;
};

/** One reaction per user per message (IG semantics - new emoji replaces old). */
export type Reaction = {
  id: string;
  message_id: string;
  group_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

/** Slim row for all-time group page aggregates (khatmah tracker) - every
 *  entry type counts, summed via pages_equiv (already page-normalized). */
export type ReadingRow = {
  user_id: string;
  logged_at: string;
  pages_equiv: number | null;
};

export type Reminder = {
  id: string;
  user_id: string;
  time: string; // "HH:MM:SS"
  days: number[]; // 0=Sun … 6=Sat
  enabled: boolean;
  created_at: string;
};

/** A one-time reminder for later today or tomorrow, set from the Today page.
 *  sent_at / skipped_at / due_at are server-owned (insert trigger + cron). */
export type DayReminder = {
  id: string;
  user_id: string;
  remind_on: string; // YYYY-MM-DD, local to the profile timezone
  time: string; // "HH:MM:SS"
  due_at: string; // ISO instant, frozen by the insert trigger
  expires_at: string; // end of its local day (+ slack), frozen with due_at
  entry_type: EntryType | null; // null = a general reminder
  note: string | null;
  sent_at: string | null; // handed to the push queue
  skipped_at: string | null; // stayed quiet: that type was logged first
  created_at: string;
};

/** Fields collected by the log form (server fills id/user/group/logged_at). */
export type NewEntry = {
  entry_type: EntryType;
  from_ref: string | null;
  to_ref: string | null;
  amount: number | null;
  unit: Unit | null;
  juz: number | null;
  part: number | null;
  mushaf: MushafId | null;
  notes: string | null;
  /** Backdated timestamp (ISO); null/absent = now. Only set for new entries. */
  logged_at?: string | null;
};
