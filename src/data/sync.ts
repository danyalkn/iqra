import { isReadingType } from "@/lib/entries";
import {
  classifySendError,
  offlineLoggedAt,
  sendOrder,
  type OutboxItem,
} from "@/lib/outbox";
import type { LogRow } from "@/lib/types";
import { claimForSend, loadOutbox, markUnsent, settleSend } from "@/storage/outbox";
import { supabase } from "@/supabase/client";

import { insertEntry, markEntriesChanged } from "./entryWrites";
import { TIMED_OUT, withTimeout } from "./timeout";

/**
 * Sends the outbox (src/storage/outbox.ts) to Supabase, oldest entry first,
 * exactly once per entry: each carries its own client-made id, so a send
 * whose reply was lost is retried into the primary key and read back as
 * landed instead of written twice (docs/NEXT-SESSION.md "Offline logging").
 *
 * Triggers (SyncController and the callers below): a new entry, the app
 * coming to the foreground, a Today load that landed, a backoff timer while
 * entries wait, and the end of a log from a notification button. One run
 * per user at a time; a trigger during a run asks for one more pass.
 *
 * After a run that sent something: markEntriesChanged() so Today and the
 * Journal refetch, the `onSynced` listeners (Today puts the rows in its list
 * before they leave the queue, so nothing flickers), and the revision nudges
 * are rebuilt when a hifz entry landed.
 */

export type SyncResult = {
  /** Rows the server now has from this run. */
  sent: LogRow[];
  /** Still waiting (not counting refused ones). */
  waiting: number;
  /** Stopped for want of a connection or a live session. */
  offline: boolean;
};

type SyncedListener = (userId: string, rows: LogRow[]) => void;
const syncedListeners = new Set<SyncedListener>();

/** Rows that just landed, before they leave the queue. */
export function onSynced(listener: SyncedListener): () => void {
  syncedListeners.add(listener);
  return () => {
    syncedListeners.delete(listener);
  };
}

/** Called once per run that landed a hifz entry (set by src/push, which owns
 *  the revision nudges; kept as a hook so this module stays free of it). */
let afterHifzSync: ((userId: string) => Promise<void>) | null = null;
export function setAfterHifzSync(fn: (userId: string) => Promise<void>): void {
  afterHifzSync = fn;
}

/** How long a run waits for supabase-js to produce a session. Offline with
 *  an expired token it retries the refresh for up to half a minute, and the
 *  row would say "saving" all that time instead of "waiting to sync". */
const SESSION_WAIT_MS = 3000;

/** The session the requests will carry, if it is this member's and usable.
 *  Offline with an expired access token supabase-js reports no session
 *  (and would send the anon key, which RLS refuses as if the row were
 *  wrong), so that counts as offline, not as a refusal. */
async function liveSessionFor(userId: string): Promise<boolean> {
  const res = await withTimeout(supabase.auth.getSession(), SESSION_WAIT_MS);
  return res !== TIMED_OUT && res.data.session?.user.id === userId;
}

type SendOutcome = "sent" | "kept" | "refused" | "offline";

/** One claimed item: send it and settle it (it always leaves "sending"). */
async function sendOne(userId: string, item: OutboxItem): Promise<SendOutcome> {
  try {
    return await sendClaimed(userId, item);
  } catch (e) {
    // Nothing above should throw; if it does, keep the entry for next time.
    console.warn("Outbox send failed", e);
    await settleSend(userId, item.id, { ...item, attempts: item.attempts + 1 });
    return "offline";
  }
}

async function sendClaimed(userId: string, item: OutboxItem): Promise<SendOutcome> {
  let current = item;
  // At most two tries: a first send refused only because 3 AM passed while
  // it was in flight goes once more with its offline time.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await insertEntry(userId, current.groupId, current.entry, {
      id: current.id,
      offlineLoggedAt: offlineLoggedAt(current),
    });
    if (res.row) {
      deliver(userId, [res.row]);
      await settleSend(userId, current.id, null);
      return "sent";
    }
    const kind = classifySendError(res);
    if (kind === "duplicate") {
      // An earlier send landed and its reply was lost. Confirm the row is
      // this member's (a stranger's id is not this entry).
      const { data, status } = await supabase
        .from("log_entries")
        .select("*")
        .eq("id", current.id)
        .maybeSingle();
      const row = data as LogRow | null;
      if (row && row.user_id === userId) {
        deliver(userId, [row]);
        await settleSend(userId, current.id, null);
        return "sent";
      }
      if (status === 0) {
        await settleSend(userId, current.id, { ...current, attempts: current.attempts + 1 });
        return "offline";
      }
      await settleSend(userId, current.id, {
        ...current,
        state: "rejected",
        reason: "refused",
        message: res.error ?? undefined,
      });
      return "refused";
    }
    if (kind === "closed" && current.attempts === 0) {
      current = { ...current, attempts: 1 };
      continue;
    }
    if (kind === "offline" || kind === "retry") {
      await settleSend(userId, current.id, { ...current, attempts: current.attempts + 1 });
      return kind === "offline" ? "offline" : "kept";
    }
    await settleSend(userId, current.id, {
      ...current,
      state: "rejected",
      reason: kind === "closed" ? "closed" : "refused",
      message: res.error ?? undefined,
    });
    return "refused";
  }
  // Unreachable: the second pass always settles.
  await settleSend(userId, current.id, current);
  return "kept";
}

function deliver(userId: string, rows: LogRow[]): void {
  for (const l of syncedListeners) {
    try {
      l(userId, rows);
    } catch (e) {
      console.warn("Sync listener failed", e);
    }
  }
}

async function runOnce(userId: string): Promise<SyncResult> {
  const items = sendOrder(await loadOutbox(userId));
  if (items.length === 0) return { sent: [], waiting: 0, offline: false };
  if (!(await liveSessionFor(userId))) {
    await markUnsent(userId);
    return { sent: [], waiting: items.length, offline: true };
  }
  const sent: LogRow[] = [];
  const unsub = onSynced((uid, rows) => {
    if (uid === userId) sent.push(...rows);
  });
  let offline = false;
  try {
    for (const queued of items) {
      // Its version now (an edit may have changed it), claimed in the same
      // tick; null when discarded, refused or already in flight.
      const item = claimForSend(userId, queued.id);
      if (!item) continue;
      const outcome = await sendOne(userId, item);
      // No connection: the rest would fail the same way. A busy server
      // ("kept") is per request, so the others still get their turn.
      if (outcome === "offline") {
        offline = true;
        await markUnsent(userId);
        break;
      }
    }
  } finally {
    unsub();
  }
  const waiting = sendOrder(await loadOutbox(userId)).length;
  if (sent.length > 0) {
    markEntriesChanged();
    if (afterHifzSync && sent.some((r) => !isReadingType(r.entry_type))) {
      await afterHifzSync(userId).catch(() => {});
    }
  }
  return { sent, waiting, offline };
}

const runs = new Map<string, { again: boolean; done: Promise<SyncResult> }>();

/**
 * Send what is waiting for `userId`. Never throws. While a run is going,
 * a call joins it and asks for one more pass (an entry queued mid-run).
 */
export function syncOutbox(userId: string): Promise<SyncResult> {
  const running = runs.get(userId);
  if (running) {
    running.again = true;
    return running.done;
  }
  const run = { again: false, done: Promise.resolve<SyncResult>({ sent: [], waiting: 0, offline: false }) };
  run.done = (async () => {
    const sent: LogRow[] = [];
    let result: SyncResult = { sent: [], waiting: 0, offline: false };
    try {
      do {
        run.again = false;
        result = await runOnce(userId);
        sent.push(...result.sent);
      } while (run.again && !result.offline);
    } catch (e) {
      console.warn("Outbox sync failed", e);
    } finally {
      runs.delete(userId);
    }
    return { ...result, sent };
  })();
  runs.set(userId, run);
  return run.done;
}
