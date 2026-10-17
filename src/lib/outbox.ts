/**
 * The offline outbox for new log entries (docs/NEXT-SESSION.md "Offline
 * logging"): the shape of a queued entry and the rules that do not depend on
 * storage or the network, so they can be read (and tested) on their own.
 *
 * Every new entry is queued first with a client-made id and sent from the
 * queue, online or not; the queue just empties at once when the request
 * lands. A send that fails for want of a connection keeps the entry queued;
 * the next send carries `offline_logged_at` (the device time the member
 * saved it), and the server's 3 AM backdate guard judges the entry by that
 * time instead of by when it arrived (owner, 2026-10-17: "go according to
 * when it was logged offline").
 *
 * Pure: no React, no DOM, no react-native. Native-first file (not yet in the
 * web repo).
 */

import { pagesEquiv } from "./entries";
import type { LogRow, NewEntry } from "./types";

/** Waiting to send, or refused by the server for good (the member decides). */
export type OutboxState = "pending" | "rejected";

/** Why the server refused it: yesterday's window had closed, or anything
 *  else it would refuse again on a retry. */
export type RejectReason = "closed" | "refused";

export type OutboxItem = {
  /** The entry's primary key, made on the device. */
  id: string;
  userId: string;
  groupId: string;
  /** The row as the log sheet (or a notification button) built it, always
   *  dated: an entry saved at 23:50 and sent at 08:00 stays on its day. */
  entry: NewEntry & { logged_at: string };
  /** Device time the member saved it. Sent as `offline_logged_at` once a
   *  send has failed (see offlineLoggedAt). */
  savedAt: string;
  /** Sends that did not land (no connection, server busy). */
  attempts: number;
  state: OutboxState;
  reason?: RejectReason;
  /** The server's words for a refusal, kept for the "Couldn't sync" row. */
  message?: string;
};

/** A queued entry as a log row, for lists, the streak and "continue from". */
export function outboxRow(item: OutboxItem): LogRow {
  const { entry } = item;
  return {
    id: item.id,
    user_id: item.userId,
    group_id: item.groupId,
    entry_type: entry.entry_type,
    from_ref: entry.from_ref,
    to_ref: entry.to_ref,
    amount: entry.amount,
    unit: entry.unit,
    juz: entry.juz,
    part: entry.part,
    mushaf: entry.mushaf,
    notes: entry.notes,
    pages_equiv: pagesEquiv(entry.amount, entry.unit),
    logged_at: entry.logged_at,
  };
}

/**
 * The server's rows with the entries still waiting to send, newest first.
 * Rejected entries are left out: they never landed, so they must not carry
 * a streak or a bookmark. A queued id the server already has (sent, but the
 * queue not yet cleared) shows once, as the server's copy.
 */
export function withPending(server: LogRow[], items: OutboxItem[]): LogRow[] {
  const pending = items.filter((i) => i.state === "pending");
  if (pending.length === 0) return server;
  const have = new Set(server.map((r) => r.id));
  const extra = pending.filter((i) => !have.has(i.id)).map(outboxRow);
  if (extra.length === 0) return server;
  return [...extra, ...server].sort(
    (a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime(),
  );
}

/** Oldest first: the order the member logged them in. */
export function sendOrder(items: OutboxItem[]): OutboxItem[] {
  return items
    .filter((i) => i.state === "pending")
    .sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
}

/** The device time to send as `offline_logged_at`: only once a send has
 *  failed, so an entry that went straight through carries none and the
 *  column marks exactly the entries that were logged without a connection. */
export function offlineLoggedAt(item: OutboxItem): string | null {
  return item.attempts > 0 ? item.savedAt : null;
}

/** What a failed send means for the queued entry. */
export type SendFailure =
  /** No answer at all: keep it, try again later. */
  | "offline"
  /** The server answered but may answer differently later (busy, token
   *  expired, a column not deployed yet): keep it, try again later. */
  | "retry"
  /** The id is already there: an earlier send landed and its reply was
   *  lost. The caller confirms it is this member's row. */
  | "duplicate"
  /** Yesterday's 3 AM window had closed. */
  | "closed"
  /** Anything else the server would refuse again. */
  | "refused";

/** Postgres raises this text from log_entries_backdate_guard. */
const CLOSED_TEXT = "Yesterday can only be logged until 3 AM";

/**
 * Sort a failed insert by what the queue should do with it. `status` is the
 * HTTP status (0 when the request never got an answer, which is how
 * postgrest-js reports a dead network), `code` the Postgres / PostgREST
 * error code.
 */
export function classifySendError(err: {
  status: number;
  code?: string | null;
  message?: string | null;
}): SendFailure {
  const { status, code, message } = err;
  if (!status) return "offline";
  if (code === "23505") return "duplicate";
  if ((message ?? "").includes(CLOSED_TEXT)) return "closed";
  // PGRST2xx: schema cache (a column the app sends before its migration is
  // live). PGRST3xx: the JWT (expired mid-flight).
  if (code && /^PGRST[23]/.test(code)) return "retry";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  return "refused";
}

/** "Log for today" on an entry refused because yesterday had closed: the
 *  same entry, dated now and sent as a fresh one. */
export function redatedToNow(item: OutboxItem, nowIso: string): OutboxItem {
  return {
    ...item,
    entry: { ...item.entry, logged_at: nowIso },
    savedAt: nowIso,
    attempts: 0,
    state: "pending",
    reason: undefined,
    message: undefined,
  };
}
