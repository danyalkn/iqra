import AsyncStorage from "@react-native-async-storage/async-storage";

import type { OutboxItem } from "@/lib/outbox";

/**
 * The per-user outbox on disk (`iqra:outbox:<userId>`), with an in-memory
 * copy that is the truth while the app runs. Rules live in src/lib/outbox.ts;
 * sending lives in src/data/sync.ts.
 *
 * One JS runtime at a time touches it: iOS wakes the app itself for a
 * notification button, and Android's notification task reuses the running
 * app's runtime when there is one. So each change is made to memory
 * synchronously (no await between reading and writing an item, which is
 * what keeps an edit and a send from racing) and then written through to
 * disk in order. Writers that must survive a suspension (the headless log
 * path) await the write.
 *
 * Keyed per user so a queue can never sync into another account; cleared on
 * sign-out only after the member chose to discard it (docs/NEXT-SESSION.md).
 */

export function outboxKey(userId: string): string {
  return `iqra:outbox:${userId}`;
}

export type OutboxSnapshot = {
  items: OutboxItem[];
  /** Ids being sent right now: shown as "Saving" and not editable. */
  sending: ReadonlySet<string>;
};

const EMPTY: OutboxSnapshot = { items: [], sending: new Set() };

const memory = new Map<string, OutboxItem[]>();
const loading = new Map<string, Promise<OutboxItem[]>>();
const sending = new Map<string, Set<string>>();
const snapshots = new Map<string, OutboxSnapshot>();
const listeners = new Set<() => void>();

function isItem(v: unknown): v is OutboxItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Partial<OutboxItem>;
  return (
    typeof o.id === "string" &&
    typeof o.userId === "string" &&
    typeof o.groupId === "string" &&
    typeof o.savedAt === "string" &&
    !!o.entry &&
    typeof o.entry.logged_at === "string"
  );
}

/** Read this user's queue from disk once per launch. */
export function loadOutbox(userId: string): Promise<OutboxItem[]> {
  const have = memory.get(userId);
  if (have) return Promise.resolve(have);
  const pending = loading.get(userId);
  if (pending) return pending;
  const p = (async () => {
    let items: OutboxItem[] = [];
    try {
      const raw = await AsyncStorage.getItem(outboxKey(userId));
      const v: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(v)) items = v.filter(isItem).filter((i) => i.userId === userId);
    } catch {
      // Unreadable: start empty rather than block logging.
    }
    // A change made while the read was in flight wins.
    const now = memory.get(userId) ?? items;
    memory.set(userId, now);
    loading.delete(userId);
    emit(userId);
    return now;
  })();
  loading.set(userId, p);
  return p;
}

/** Synchronous view for React (useSyncExternalStore): stable until changed. */
export function outboxSnapshot(userId: string | null): OutboxSnapshot {
  if (!userId) return EMPTY;
  return snapshots.get(userId) ?? EMPTY;
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(userId: string): void {
  snapshots.set(userId, {
    items: memory.get(userId) ?? [],
    sending: new Set(sending.get(userId) ?? []),
  });
  for (const l of listeners) l();
}

// Disk writes run one at a time, each writing memory as it is by then, so
// the last write always holds the latest queue.
let writes: Promise<void> = Promise.resolve();
function persist(userId: string): Promise<void> {
  writes = writes.then(async () => {
    try {
      const items = memory.get(userId);
      if (items == null) return;
      if (items.length === 0) await AsyncStorage.removeItem(outboxKey(userId));
      else await AsyncStorage.setItem(outboxKey(userId), JSON.stringify(items));
    } catch (e) {
      console.warn("Outbox write failed", e);
    }
  });
  return writes;
}

function set(userId: string, items: OutboxItem[]): Promise<void> {
  memory.set(userId, items);
  emit(userId);
  return persist(userId);
}

/** Queue a new entry (resolves once it is on disk). */
export async function enqueue(item: OutboxItem): Promise<void> {
  const items = await loadOutbox(item.userId);
  if (items.some((i) => i.id === item.id)) return;
  await set(item.userId, [...items, item]);
}

/** Wait for `id` to finish sending, then resume in a tick where it is
 *  loaded and not being sent, so the caller's change (made synchronously
 *  after this resolves) can never land under a send of the old version. */
async function settledItems(userId: string, id: string): Promise<OutboxItem[]> {
  for (;;) {
    const items = await loadOutbox(userId);
    if (!isSending(userId, id)) return items;
    await whenNotSending(userId, id);
  }
}

/** Change one queued item for the member (an edit, Try again, Log for
 *  today). Waits out a send in flight. Returns the new item, or null when it
 *  is gone (it was sent meanwhile: the caller edits the server row instead)
 *  or `change` returned null. */
export async function updateQueued(
  userId: string,
  id: string,
  change: (item: OutboxItem) => OutboxItem | null,
): Promise<OutboxItem | null> {
  const items = await settledItems(userId, id);
  const current = items.find((i) => i.id === id);
  if (!current) return null;
  const next = change(current);
  if (!next) return null;
  await set(
    userId,
    items.map((i) => (i.id === id ? next : i)),
  );
  return next;
}

/** Discard one queued item for the member. Waits out a send in flight;
 *  false when it was sent meanwhile (the caller deletes the server row). */
export async function discardQueued(userId: string, id: string): Promise<boolean> {
  const items = await settledItems(userId, id);
  if (!items.some((i) => i.id === id)) return false;
  await set(
    userId,
    items.filter((i) => i.id !== id),
  );
  return true;
}

/** Discard the whole queue (sign-out after the member chose to, account
 *  deletion). */
export async function clearOutbox(userId: string): Promise<void> {
  await loadOutbox(userId);
  await set(userId, []);
}

// ── Sends in flight (src/data/sync.ts only) ───────────────────────────────

const settled = new Map<string, (() => void)[]>();

/** Claim a pending item for sending: its current version, marked as in
 *  flight in the same tick, or null when it is gone, refused or already
 *  being sent. Call after loadOutbox. */
export function claimForSend(userId: string, id: string): OutboxItem | null {
  if (isSending(userId, id)) return null;
  const item = memory.get(userId)?.find((i) => i.id === id && i.state === "pending");
  if (!item) return null;
  const s = sending.get(userId) ?? new Set<string>();
  s.add(id);
  sending.set(userId, s);
  emit(userId);
  return item;
}

/** The sender's own change to an item it holds (fewer attempts left, refused,
 *  or gone once sent): no waiting, it is the one in flight. */
export function settleSend(
  userId: string,
  id: string,
  next: OutboxItem | null,
): Promise<void> {
  const items = memory.get(userId) ?? [];
  const written = set(
    userId,
    next ? items.map((i) => (i.id === id ? next : i)) : items.filter((i) => i.id !== id),
  );
  sending.get(userId)?.delete(id);
  emit(userId);
  const waiters = settled.get(id);
  settled.delete(id);
  waiters?.forEach((w) => w());
  return written;
}

/** A run that could not send at all (no connection or no live session)
 *  counts as a failed attempt for every waiting item that has none yet:
 *  the entry was logged offline, so its row says "Waiting to sync" and its
 *  send will carry the offline time. */
export function markUnsent(userId: string): Promise<void> {
  const items = memory.get(userId);
  if (!items?.some((i) => i.state === "pending" && i.attempts === 0 && !isSending(userId, i.id))) {
    return Promise.resolve();
  }
  return set(
    userId,
    items.map((i) =>
      i.state === "pending" && i.attempts === 0 && !isSending(userId, i.id)
        ? { ...i, attempts: 1 }
        : i,
    ),
  );
}

export function isSending(userId: string, id: string): boolean {
  return sending.get(userId)?.has(id) ?? false;
}

function whenNotSending(userId: string, id: string): Promise<void> {
  if (!isSending(userId, id)) return Promise.resolve();
  return new Promise((resolve) => {
    settled.set(id, [...(settled.get(id) ?? []), resolve]);
  });
}
