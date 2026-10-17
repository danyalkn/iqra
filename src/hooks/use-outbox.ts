import { useEffect, useSyncExternalStore } from "react";

import { loadOutbox, outboxSnapshot, subscribeOutbox, type OutboxSnapshot } from "@/storage/outbox";

/** This member's outbox (src/storage/outbox.ts), live: queued entries and
 *  the ids being sent right now. Empty until the queue has been read. */
export function useOutbox(userId: string | null): OutboxSnapshot {
  useEffect(() => {
    if (userId) void loadOutbox(userId);
  }, [userId]);
  return useSyncExternalStore(subscribeOutbox, () => outboxSnapshot(userId));
}
