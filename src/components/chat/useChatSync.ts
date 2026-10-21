import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { ChatRead, Reaction } from "@/lib/types";
import { setChatVisible } from "@/push/chatVisibility";
import { supabase } from "@/supabase/client";

import type { ChatMessage } from "./contracts";
import { isTemp, parseTs } from "./shared";

/** First load of the chat: not landed, landed, or failed before ever
 *  landing. Once "ready" it stays ready; a later sync that fails keeps the
 *  list and raises `stale` instead. */
export type ChatLoadState = "loading" | "ready" | "failed";

/** Hidden longer than this and the realtime socket is assumed to be a
 *  zombie: the next foreground does a hard transport reset (web: 15 s). */
const ZOMBIE_AFTER_MS = 15_000;
/** Safety-net poll while the chat is on screen (web: 20 s). */
const POLL_MS = 20_000;

/**
 * Messages, reactions and read frontiers for one circle, with the realtime
 * transport and every healing layer ported from
 * reference/web-pwa/app/(app)/chat/ChatClient.tsx (syncMessages,
 * syncReactions, syncReads, markRead and the channel effect are verbatim;
 * docs/DECISIONS.md § Chat: port the reconnect logic, do not rewrite it).
 *
 * Native differences, all in the "visibility" layer the web built on
 * document.visibilityState / window focus / the online event:
 * - AppState stands in for visibilitychange: background or inactive marks
 *   hiddenAt; active does ensureLive(away > 15 s) plus the three syncs.
 * - expo-router's useFocusEffect stands in for window focus: the tab
 *   coming back does ensureLive(false) plus the three syncs.
 * - "Visible" (markRead and the 20 s poll) means the screen is focused AND
 *   the app is active; NativeTabs keeps every tab mounted, so focus alone
 *   is not enough.
 * - There is no online event; the AppState and focus paths cover the cases
 *   it handled (a dead socket is caught by the heartbeat in
 *   src/supabase/client.ts).
 * - The web had its data at first paint; here the three syncs run on mount
 *   and `loadState` says whether the first one landed.
 */
export function useChatSync({
  groupId,
  userId,
  initialReads,
}: {
  groupId: string;
  userId: string;
  /** Every member's frontier at open (seeds `reads` and our own latch). */
  initialReads: ChatRead[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  // Read frontiers: user_id → newest message time they have seen (IG model).
  const [reads, setReads] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialReads.map((r) => [r.user_id, r.last_read_at])),
  );
  const [loadState, setLoadState] = useState<ChatLoadState>("loading");
  // A sync failed after the first load landed; cleared by the next success.
  const [stale, setStale] = useState(false);

  // Screen focused (tab) and app active: the two halves of "visible".
  const focused = useRef(false);
  const active = useRef(AppState.currentState === "active");
  const isVisible = useCallback(() => focused.current && active.current, []);

  // Re-fetch + merge messages. Heals gaps left when the realtime socket drops
  // (backgrounded app, network blip) - missed messages reappear without the
  // user having to manually refresh.
  //
  // Failure handling matters more than the fetch: after an iOS suspend the
  // client's access token is often expired, and supabase-js then either
  // errors (401) or - if the session is gone - silently falls back to the
  // ANON key, where RLS returns 200 with zero rows. Both used to read as
  // "nothing new" and made every healing layer a no-op. Now: on error or a
  // suspicious empty result, force a session re-read (which refreshes an
  // expired token from storage) and retry once.
  //
  // Returns whether the server answer is known (true even for a genuinely
  // empty chat), so the first load can tell "nothing yet" from "no answer".
  const syncMessages = useCallback(async (): Promise<boolean> => {
    const fetchPage = () =>
      supabase
        .from("messages")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(100);

    let { data, error } = await fetchPage();
    if (error || data == null || data.length === 0) {
      const { data: s } = await supabase.auth.getSession();
      if (error || data == null) {
        if (s.session) await supabase.realtime.setAuth().catch(() => {});
        ({ data, error } = await fetchPage());
        if (error || data == null) {
          // still unknown - never fake "empty"
          setStale(true);
          setLoadState((cur) => (cur === "loading" ? "failed" : cur));
          return false;
        }
      } else if (!s.session) {
        // 200 + empty with no session = anon-key downgrade, not an empty chat.
        setStale(true);
        setLoadState((cur) => (cur === "loading" ? "failed" : cur));
        return false;
      }
    }
    setStale(false);
    setLoadState("ready");
    const server = ((data as ChatMessage[] | null) ?? []).reverse();
    if (server.length === 0) return true;
    setMessages((prev) => {
      const byId = new Map<string, ChatMessage>();
      for (const m of server) byId.set(m.id, m);
      // keep still-pending optimistic sends not yet on the server
      for (const m of prev) {
        if (isTemp(m.id) && !byId.has(m.id)) byId.set(m.id, m);
      }
      const next = Array.from(byId.values()).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      // No change → keep the same reference so we don't re-render / re-scroll.
      if (next.length === prev.length && next.every((m, i) => m.id === prev[i].id)) {
        return prev;
      }
      return next;
    });
    return true;
  }, [groupId]);

  // Same healing pattern for reactions: refetch and merge, keeping in-flight
  // optimistic rows that haven't landed server-side yet. A failed fetch must
  // NEVER be treated as "no reactions" - that used to wipe them all.
  const syncReactions = useCallback(async () => {
    const fetchAll = () =>
      supabase
        .from("message_reactions")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true })
        .limit(1000);

    let { data, error } = await fetchAll();
    if (error || data == null) {
      await supabase.auth.getSession(); // refresh an expired session, then retry
      ({ data, error } = await fetchAll());
      if (error || data == null) return;
    }
    const server = (data as Reaction[] | null) ?? [];
    setReactions((prev) => {
      const next = [...server];
      for (const r of prev) {
        if (
          isTemp(r.id) &&
          !next.some((s) => s.message_id === r.message_id && s.user_id === r.user_id)
        ) {
          next.push(r);
        }
      }
      // No change -> keep the same reference, as syncMessages does. A new
      // array re-renders every row on each 20 s poll and focus, and the
      // list re-measures under the reader (the chat "twitch").
      if (
        next.length === prev.length &&
        next.every((r, i) => r.id === prev[i].id && r.emoji === prev[i].emoji)
      ) {
        return prev;
      }
      return next;
    });
  }, [groupId]);

  // ── Read receipts ─────────────────────────────────────────────────────────
  // Our own frontier: advance it to the newest server message whenever the
  // chat is actually on screen. Fire-and-forget with a retry latch - a failed
  // upsert resets the latch so the next trigger tries again.
  const lastMarked = useRef<string | null>(
    initialReads.find((r) => r.user_id === userId)?.last_read_at ?? null,
  );
  const markRead = useCallback(async () => {
    if (!isVisible()) return;
    let newest: ChatMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!isTemp(messages[i].id)) {
        newest = messages[i];
        break;
      }
    }
    if (!newest) return;
    const prev = lastMarked.current;
    if (prev && parseTs(newest.created_at) <= parseTs(prev)) return;
    lastMarked.current = newest.created_at;
    const { error } = await supabase.from("chat_reads").upsert(
      {
        group_id: groupId,
        user_id: userId,
        last_read_at: newest.created_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "group_id,user_id" },
    );
    if (error) lastMarked.current = prev; // retry on the next trigger
  }, [messages, groupId, userId, isVisible]);

  // Frontiers heal like messages/reactions do: refetch and merge. Never treat
  // a failed fetch as "nobody has read anything".
  const syncReads = useCallback(async () => {
    const { data, error } = await supabase
      .from("chat_reads")
      .select("user_id, last_read_at")
      .eq("group_id", groupId);
    if (error || data == null) return;
    for (const r of data as ChatRead[]) {
      // Another of MY devices may be further along - adopt its frontier so
      // this device doesn't try to write an older one (the server trigger
      // keeps frontiers monotonic regardless; this just avoids the futile
      // write).
      if (
        r.user_id === userId &&
        (!lastMarked.current || parseTs(r.last_read_at) > parseTs(lastMarked.current))
      ) {
        lastMarked.current = r.last_read_at;
      }
    }
    setReads((prev) => {
      // Copied only when a frontier moves, so an unchanged poll keeps the
      // same reference (see syncReactions).
      let next: Record<string, string> | null = null;
      for (const r of data as ChatRead[]) {
        const cur = (next ?? prev)[r.user_id];
        // Frontiers only move forward - a stale fetch must not rewind one.
        if (!cur || parseTs(r.last_read_at) > parseTs(cur)) {
          next ??= { ...prev };
          next[r.user_id] = r.last_read_at;
        }
      }
      return next ?? prev;
    });
  }, [groupId, userId]);

  // The current markRead for the focus / AppState handlers, which must not
  // re-subscribe every time `messages` changes.
  const markReadRef = useRef(markRead);
  useEffect(() => {
    markReadRef.current = markRead;
  }, [markRead]);

  // Mark read when messages change while the chat is on screen (the
  // foreground and focus cases are below, with their syncs).
  useEffect(() => {
    void markRead();
  }, [markRead]);

  const syncAll = useCallback(() => {
    void syncMessages();
    void syncReactions();
    void syncReads();
  }, [syncMessages, syncReactions, syncReads]);

  // Realtime transport. Hardened against every silent-death mode we've hit:
  // - Fresh topic per join: supabase.channel() returns an existing same-topic
  //   instance while the old one is still tearing down, and subscribing to it
  //   silently no-ops - unique topics sidestep the remount race entirely.
  // - CHANNEL_ERROR / TIMED_OUT / CLOSED rebuild the channel with backoff
  //   after refreshing auth; errored channels never self-heal upstream
  //   (supabase realtime-js#274 - closed "not planned"), so rejoining is ours.
  // - ensureLive() (called on wake/focus) force-resets the transport when
  //   the channel isn't joined or the app was suspended long enough that the
  //   socket is likely a zombie that still claims to be connected.
  // - postgres_changes has no replay: every (re)join resyncs via REST.
  const joinSeq = useRef(0);
  const ensureLive = useRef<(hard: boolean) => void>(() => {});

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let joined = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const teardown = () => {
      joined = false;
      if (channel) {
        const ch = channel;
        channel = null;
        void supabase.removeChannel(ch);
      }
    };

    const rejoinNow = async () => {
      if (disposed) return;
      // Joins fail for stale JWTs more than anything else: re-read the session
      // (refreshing it if expired) and push the fresh token to the socket.
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session) {
        try {
          await supabase.realtime.setAuth();
        } catch {
          /* non-fatal - join carries the token too */
        }
      }
      join();
    };

    const scheduleRejoin = () => {
      if (disposed || retry) return;
      const delay = Math.min(15_000, 1_000 * 2 ** Math.min(attempt++, 4));
      retry = setTimeout(() => {
        retry = null;
        void rejoinNow();
      }, delay);
    };

    const join = () => {
      if (disposed) return;
      teardown();
      const ch = supabase
        .channel(`chat-${groupId}-${++joinSeq.current}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `group_id=eq.${groupId}`,
          },
          (payload) => {
            const row = payload.new as ChatMessage;
            if (row.user_id === userId) return;
            setMessages((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row]));
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "message_reactions",
            filter: `group_id=eq.${groupId}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as Partial<Reaction>;
              setReactions((prev) =>
                prev.filter(
                  (r) =>
                    r.id !== old.id &&
                    !(
                      old.message_id &&
                      r.message_id === old.message_id &&
                      r.user_id === old.user_id
                    ),
                ),
              );
              return;
            }
            const row = payload.new as Reaction;
            if (row.user_id === userId) return; // ours are optimistic
            setReactions((prev) => [
              ...prev.filter(
                (r) => !(r.message_id === row.message_id && r.user_id === row.user_id),
              ),
              row,
            ]);
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_reads",
            filter: `group_id=eq.${groupId}`,
          },
          (payload) => {
            const row = payload.new as Partial<ChatRead>;
            if (!row.user_id || !row.last_read_at || row.user_id === userId) return;
            const uid = row.user_id;
            const at = row.last_read_at;
            setReads((prev) => {
              const cur = prev[uid];
              if (cur && parseTs(at) <= parseTs(cur)) return prev;
              return { ...prev, [uid]: at };
            });
          },
        )
        .subscribe((status) => {
          if (disposed || ch !== channel) return; // stale channel's echo
          if (status === "SUBSCRIBED") {
            joined = true;
            attempt = 0;
            // No replay on postgres_changes - refill whatever we missed.
            void syncMessages();
            void syncReactions();
            void syncReads();
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            joined = false;
            scheduleRejoin();
          }
        });
      channel = ch;
    };

    ensureLive.current = (hard) => {
      if (disposed) return;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      attempt = 0;
      if (hard) {
        // Post-suspend the socket can be a zombie that still claims to be
        // connected (dead TCP; ~25-50s until heartbeat timeout notices).
        // Cycling it now beats waiting that out. Detach the channel first so
        // its disconnect-driven CLOSED echo can't schedule a second rejoin.
        teardown();
        try {
          supabase.realtime.disconnect();
        } catch {
          /* already down */
        }
        void rejoinNow();
      } else if (!joined) {
        void rejoinNow();
      }
    };

    join();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      ensureLive.current = () => {};
      teardown();
    };
  }, [groupId, userId, syncMessages, syncReactions, syncReads]);

  // `retry` is the explicit re-run behind the error state's button; the
  // first load itself happens on the first focus, below.
  const retry = useCallback(() => {
    setLoadState("loading");
    ensureLive.current(false);
    syncAll();
  }, [syncAll]);

  // Wake handlers. Leaving the foreground on a phone usually means the app
  // gets suspended - track how long we were away and do a hard transport
  // reset when it was long enough for the socket to have died underneath us.
  useEffect(() => {
    let hiddenAt: number | null = null;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        active.current = false;
        setChatVisible(false);
        // inactive -> background must not restart the clock.
        if (hiddenAt == null) hiddenAt = Date.now();
        return;
      }
      active.current = true;
      setChatVisible(focused.current);
      const away = hiddenAt == null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      ensureLive.current(away > ZOMBIE_AFTER_MS);
      syncAll();
      void markReadRef.current();
    });
    return () => sub.remove();
  }, [syncAll]);

  // Tab focus stands in for window focus: make sure the channel is live and
  // refill whatever arrived while another tab was up.
  //
  // The first focus is also the first load. The web page fetched messages,
  // reactions and reads on the server before rendering; here the same three
  // syncs run when the tab is first shown, and `loadState` follows
  // syncMessages (a join that fails offline would otherwise leave the
  // spinner up forever). The channel effect above has already started its
  // join by then, so ensureLive is skipped once: it would tear down a join
  // still in flight and start another.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      // The push handler suppresses chat banners while the chat is on screen.
      setChatVisible(active.current);
      if (firstFocus.current) {
        firstFocus.current = false;
      } else {
        ensureLive.current(false);
      }
      syncAll();
      void markReadRef.current();
      return () => {
        focused.current = false;
        setChatVisible(false);
      };
    }, [syncAll]),
  );

  // Safety-net poll while the chat is open and visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (isVisible()) syncAll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [syncAll, isVisible]);

  return {
    messages,
    setMessages,
    reactions,
    setReactions,
    reads,
    setReads,
    loadState,
    stale,
    retry,
  };
}
