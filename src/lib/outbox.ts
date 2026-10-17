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
  /** The server's words for a refusal (kept for debugging; members see a
   *  plain sentence instead). */
  message?: string;
  /** Discarded by the member after a send had already failed: that send
   *  may have landed with its reply lost, so the queue still owes the
   *  server a delete of this id. Hidden everywhere meanwhile. */
  discard?: boolean;
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
 * queue not yet cleared) shows once, as the server's copy, unless the queue
 * holds the member's edit of it (waiting entries are editable). A discarded
 * id is hidden even when the server still has it.
 */
export function withPending(server: LogRow[], items: OutboxItem[]): LogRow[] {
  const pending = items.filter((i) => i.state === "pending");
  if (pending.length === 0) return server;
  const gone = new Set(pending.filter((i) => i.discard).map((i) => i.id));
  const shown = pending.filter((i) => !i.discard);
  const mine = new Set(shown.map((i) => i.id));
  const base = server.filter((r) => !gone.has(r.id) && !mine.has(r.id));
  if (base.length === server.length && shown.length === 0) return server;
  return [...shown.map(outboxRow), ...base].sort(
    (a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime(),
  );
}

/** Entries still owed to the server and shown as waiting (not discards). */
export function waitingItems(items: OutboxItem[]): OutboxItem[] {
  return items.filter((i) => i.state === "pending" && !i.discard);
}

/** Oldest first: the order the member logged them in (discards included:
 *  they are owed a delete). */
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
  /** Required on purpose: an insert result calls it `error`, and passing
   *  that result whole once left the 3 AM text unread. */
  message: string | null | undefined;
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

/** Did the server's copy of a queued entry miss the member's later edit?
 *  (A send landed with its reply lost, then the waiting row was edited.)
 *  Compares the fields an edit can change. */
export function differsFromServer(item: OutboxItem, row: LogRow): boolean {
  const e = item.entry;
  const num = (v: number | string | null) => (v == null ? null : Number(v));
  return (
    e.entry_type !== row.entry_type ||
    e.from_ref !== row.from_ref ||
    e.to_ref !== row.to_ref ||
    num(e.amount) !== num(row.amount) ||
    e.unit !== row.unit ||
    num(e.juz) !== num(row.juz) ||
    num(e.part) !== num(row.part) ||
    (e.notes ?? null) !== (row.notes ?? null) ||
    (e.mushaf != null && e.mushaf !== row.mushaf)
  );
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
