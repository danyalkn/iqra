"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Reply,
  Search,
  Send,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { ChatRead, GroupMember, Message, Reaction } from "@/lib/types";
import { chatStamp, timeLabel } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { useSwipeDownDismiss } from "@/lib/useSwipeDownDismiss";

// Show a centered time separator when a message lands ≥1h after the previous
// one (within the hour, consecutive messages share the last separator).
const GAP_MS = 60 * 60 * 1000;

// IG's quick-reaction set, in IG's order.
const QUICK_EMOJI = ["❤️", "😂", "😮", "😢", "😡", "👍"];

const LONG_PRESS_MS = 420;
const SWIPE_REPLY_TRIGGER = 52;

/** "@all" mentions every member, so it notifies even people who muted chat. */
const ALL_TOKEN = "all";
const ALL_RE = /(?:^|\s)@all(?![\w])/;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a Postgres timestamp defensively. Realtime payloads can serialize
 *  timestamptz WITHOUT an offset ("2026-09-03T05:40:47.287442") - Date.parse
 *  would read that as device-local time and shift it by hours, silently
 *  corrupting every frontier comparison. Bare timestamps here are always UTC. */
function parseTs(s: string): number {
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
}

function firstName(name: string | undefined | null): string {
  return (name ?? "Member").split(/\s+/)[0];
}

/** Render a message body, highlighting @mentions of known members. */
function MessageBody({
  body,
  names,
  mine,
}: {
  body: string;
  names: string[];
  mine: boolean;
}) {
  // Member names first so a name starting with "All" wins over @all.
  const re = new RegExp(
    `@(${[...names.map(escapeRe), `${ALL_TOKEN}(?![\\w])`].join("|")})`,
    "g",
  );
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(body))) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(
      <span
        key={i++}
        className={cn(
          "rounded px-0.5 font-semibold",
          mine ? "underline" : "bg-accent-tint text-accent",
        )}
      >
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return <>{out}</>;
}

type Anchor = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Floating long-press overlay: IG-style emoji bar above the message and a
 *  Reply / Copy menu below it. Exported for visual previews. */
export function ActionOverlay({
  anchor,
  mine,
  myEmoji,
  onReact,
  onReply,
  onCopy,
  onClose,
}: {
  anchor: Anchor;
  mine: boolean;
  myEmoji: string | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  const PILL_W = 272;
  const MENU_W = 168;
  // Portal-only component - never render during SSR.
  if (typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const clampX = (x: number, w: number) => Math.min(Math.max(x, 8), vw - w - 8);
  const pillLeft = clampX(mine ? anchor.right - PILL_W : anchor.left, PILL_W);
  const menuLeft = clampX(mine ? anchor.right - MENU_W : anchor.left, MENU_W);
  const roomAbove = anchor.top - 64 >= 12;
  const pillTop = roomAbove ? anchor.top - 60 : anchor.bottom + 10;
  const menuTop = roomAbove ? anchor.bottom + 10 : pillTop + 56;

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />

      {/* Quick reactions */}
      <div
        className="absolute flex items-center gap-1 rounded-full bg-surface p-1.5 shadow-e3 animate-[dialIn_170ms_var(--ease-spring)_both]"
        style={{ top: pillTop, left: pillLeft, width: PILL_W }}
      >
        {QUICK_EMOJI.map((e) => (
          <button
            key={e}
            onClick={() => onReact(e)}
            aria-label={`React ${e}`}
            className={cn(
              "grid size-[40px] place-items-center rounded-full text-[24px] leading-none transition active:scale-125",
              myEmoji === e && "bg-accent-tint",
            )}
          >
            {e}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div
        className="absolute overflow-hidden rounded-2xl bg-surface shadow-e3 animate-[dialIn_190ms_var(--ease-spring)_both]"
        style={{ top: menuTop, left: menuLeft, width: MENU_W }}
      >
        <button
          onClick={onReply}
          className="flex w-full items-center justify-between px-4 py-3 text-callout font-medium"
        >
          Reply <Reply className="size-4.5 text-muted" />
        </button>
        <div className="h-px bg-border" />
        <button
          onClick={onCopy}
          className="flex w-full items-center justify-between px-4 py-3 text-callout font-medium"
        >
          Copy <Copy className="size-4.5 text-muted" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Grouped reaction chip hugging the bubble's bottom corner (IG style). */
export function ReactionChips({
  reactions,
  mine,
  onOpen,
}: {
  reactions: Reaction[];
  mine: boolean;
  onOpen: () => void;
}) {
  if (reactions.length === 0) return null;
  const emojis: string[] = [];
  for (const r of reactions) {
    if (!emojis.includes(r.emoji)) emojis.push(r.emoji);
    if (emojis.length === 3) break;
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cn(
        "absolute -bottom-3.5 z-10 flex items-center rounded-full bg-surface px-1.5 py-0.5 shadow-e1 ring-1 ring-border animate-[dialIn_170ms_var(--ease-spring)_both]",
        mine ? "right-1" : "left-1",
      )}
      aria-label="See who reacted"
    >
      <span className="text-[13px] leading-[18px]">{emojis.join("")}</span>
      {reactions.length > 1 && (
        <span className="ml-0.5 text-caption tabular-nums text-muted">
          {reactions.length}
        </span>
      )}
    </button>
  );
}

type SearchUser = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  email: string;
  is_member: boolean;
};

export function ChatClient({
  groupId,
  groupName,
  tz,
  userId,
  members: initialMembers,
  initialMessages,
  initialReactions,
  initialReads,
  initialNotifyChat,
  isOwner,
}: {
  groupId: string;
  groupName: string;
  tz: string;
  userId: string;
  members: GroupMember[];
  initialMessages: Message[];
  initialReactions: Reaction[];
  initialReads: ChatRead[];
  initialNotifyChat: boolean;
  isOwner: boolean;
}) {
  const [members, setMembers] = useState<GroupMember[]>(initialMembers);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions);
  // Read frontiers: user_id → newest message time they have seen (IG model).
  const [reads, setReads] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialReads.map((r) => [r.user_id, r.last_read_at])),
  );
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{
    q: string;
    start: number;
  } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Long-press / context-menu action overlay.
  const [action, setAction] = useState<{ msg: Message; anchor: Anchor } | null>(
    null,
  );
  // "Who reacted" sheet.
  const [reactorsFor, setReactorsFor] = useState<string | null>(null);
  // Briefly highlight a message after jumping to it from a reply quote.
  const [flashId, setFlashId] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const caretToSet = useRef<number | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ mid: string; t: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Swipe-left reveals times (iMessage); swipe-right on a message replies (IG).
  const [revealX, setRevealX] = useState(0);
  const [swipeReply, setSwipeReply] = useState<{ mid: string; x: number } | null>(
    null,
  );
  const drag = useRef<{
    x: number;
    y: number;
    axis: null | "x" | "y";
    mid: string | null;
  } | null>(null);

  const [showMembers, setShowMembers] = useState(false);
  const [notifyChat, setNotifyChat] = useState(initialNotifyChat);

  // Swipe down on the composer to dismiss the keyboard.
  const swipeDown = useSwipeDownDismiss();

  const toggleNotifyChat = async () => {
    const next = !notifyChat;
    setNotifyChat(next);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ notify_chat: next })
      .eq("id", userId);
    if (error) setNotifyChat(!next); // revert on failure
  };

  // ── Owner-only: add members ───────────────────────────────────────────────
  const [memberQuery, setMemberQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    const q = memberQuery.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("search_users", {
        p_group_id: groupId,
        q,
      });
      setResults((data as SearchUser[] | null) ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [memberQuery, isOwner, groupId]);

  const addMember = async (u: SearchUser) => {
    setAddingId(u.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("add_group_member", {
      p_group_id: groupId,
      p_user_id: u.id,
    });
    setAddingId(null);
    if (error) return;
    setResults((r) =>
      r.map((x) => (x.id === u.id ? { ...x, is_member: true } : x)),
    );
    setMembers((m) =>
      m.some((x) => x.user_id === u.id)
        ? m
        : [
            ...m,
            {
              user_id: u.id,
              display_name: u.display_name,
              avatar_url: u.avatar_url,
            },
          ],
    );
  };

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.user_id, m])),
    [members],
  );
  const memberNames = useMemo(
    () => members.map((m) => m.display_name),
    [members],
  );
  const messageMap = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );
  const reactionsByMsg = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) {
      (map.get(r.message_id) ?? map.set(r.message_id, []).get(r.message_id)!).push(
        r,
      );
    }
    return map;
  }, [reactions]);

  // IG-style read receipts: every OTHER member's avatar sits under the last
  // non-pending message at or before their frontier, and simply STAYS there
  // as new messages arrive - no exceptions, including under their own
  // messages. (The first ship skipped a member whose frontier landed on
  // their own message; in a two-person conversation that is the usual state,
  // so receipts kept vanishing. Owner direction: the marker never hides.)
  // Accepted limit: a frontier older than the loaded 100-message window shows
  // no avatar at all - truthful omission beats pinning the receipt to a
  // message they never actually reached.
  const receiptsByMsg = useMemo(() => {
    const map = new Map<string, GroupMember[]>();
    for (const m of members) {
      if (m.user_id === userId) continue;
      const iso = reads[m.user_id];
      if (!iso) continue;
      const frontier = parseTs(iso);
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.id.startsWith("temp-")) continue;
        if (parseTs(msg.created_at) <= frontier) {
          (map.get(msg.id) ?? map.set(msg.id, []).get(msg.id)!).push(m);
          break;
        }
      }
    }
    return map;
  }, [members, reads, messages, userId]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      atBottomRef.current = true;
    });
  }, []);

  // Re-fetch + merge messages. Heals gaps left when the realtime socket drops
  // (backgrounded PWA, network blip) - missed messages reappear without the
  // user having to manually refresh.
  //
  // Failure handling matters more than the fetch: after an iOS suspend the
  // client's access token is often expired, and supabase-js then either
  // errors (401) or - if the session is gone - silently falls back to the
  // ANON key, where RLS returns 200 with zero rows. Both used to read as
  // "nothing new" and made every healing layer a no-op. Now: on error or a
  // suspicious empty result, force a session re-read (which refreshes an
  // expired token from the auth cookies) and retry once.
  const syncMessages = useCallback(async () => {
    const supabase = createClient();
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
        if (error || data == null) return; // still unknown - never fake "empty"
      } else if (!s.session) {
        // 200 + empty with no session = anon-key downgrade, not an empty chat.
        return;
      }
    }
    const server = ((data as Message[] | null) ?? []).reverse();
    if (server.length === 0) return;
    setMessages((prev) => {
      const byId = new Map<string, Message>();
      for (const m of server) byId.set(m.id, m);
      // keep still-pending optimistic sends not yet on the server
      for (const m of prev) {
        if (m.id.startsWith("temp-") && !byId.has(m.id)) byId.set(m.id, m);
      }
      const next = Array.from(byId.values()).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      );
      // No change → keep the same reference so we don't re-render / re-scroll.
      if (
        next.length === prev.length &&
        next.every((m, i) => m.id === prev[i].id)
      ) {
        return prev;
      }
      return next;
    });
  }, [groupId]);

  // Same healing pattern for reactions: refetch and merge, keeping in-flight
  // optimistic rows that haven't landed server-side yet. A failed fetch must
  // NEVER be treated as "no reactions" - that used to wipe them all.
  const syncReactions = useCallback(async () => {
    const supabase = createClient();
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
          r.id.startsWith("temp-") &&
          !next.some(
            (s) => s.message_id === r.message_id && s.user_id === r.user_id,
          )
        ) {
          next.push(r);
        }
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
    if (document.visibilityState !== "visible") return;
    let newest: Message | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messages[i].id.startsWith("temp-")) {
        newest = messages[i];
        break;
      }
    }
    if (!newest) return;
    const prev = lastMarked.current;
    if (prev && parseTs(newest.created_at) <= parseTs(prev)) return;
    lastMarked.current = newest.created_at;
    const supabase = createClient();
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
  }, [messages, groupId, userId]);

  // Frontiers heal like messages/reactions do: refetch and merge. Never treat
  // a failed fetch as "nobody has read anything".
  const syncReads = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("chat_reads")
      .select("user_id, last_read_at")
      .eq("group_id", groupId);
    if (error || data == null) return;
    for (const r of data as ChatRead[]) {
      // Another of MY devices may be further along - adopt its frontier so
      // this tab doesn't try to write an older one (the server trigger keeps
      // frontiers monotonic regardless; this just avoids the futile write).
      if (
        r.user_id === userId &&
        (!lastMarked.current ||
          parseTs(r.last_read_at) > parseTs(lastMarked.current))
      ) {
        lastMarked.current = r.last_read_at;
      }
    }
    setReads((prev) => {
      const next = { ...prev };
      for (const r of data as ChatRead[]) {
        const cur = next[r.user_id];
        // Frontiers only move forward - a stale fetch must not rewind one.
        if (!cur || parseTs(r.last_read_at) > parseTs(cur)) {
          next[r.user_id] = r.last_read_at;
        }
      }
      return next;
    });
  }, [groupId, userId]);

  // Mark read when messages change while the chat is on screen, and when the
  // app comes back to the foreground with the chat open.
  useEffect(() => {
    markRead();
  }, [markRead]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [markRead]);

  // Realtime transport. Hardened against every silent-death mode we've hit:
  // - Fresh topic per join: supabase.channel() returns an existing same-topic
  //   instance while the old one is still tearing down, and subscribing to it
  //   silently no-ops - unique topics sidestep the remount race entirely.
  // - CHANNEL_ERROR / TIMED_OUT / CLOSED rebuild the channel with backoff
  //   after refreshing auth; errored channels never self-heal upstream
  //   (supabase realtime-js#274 - closed "not planned"), so rejoining is ours.
  // - ensureLive() (called on wake/online) force-resets the transport when
  //   the channel isn't joined or the app was suspended long enough that the
  //   socket is likely a zombie that still claims to be connected.
  // - postgres_changes has no replay: every (re)join resyncs via REST.
  const joinSeq = useRef(0);
  const ensureLive = useRef<(hard: boolean) => void>(() => {});

  useEffect(() => {
    const supabase = createClient();
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
        supabase.removeChannel(ch);
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
        rejoinNow();
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
          const row = payload.new as Message;
          if (row.user_id === userId) return;
          setMessages((prev) =>
            prev.some((x) => x.id === row.id) ? prev : [...prev, row],
          );
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
              (r) =>
                !(r.message_id === row.message_id && r.user_id === row.user_id),
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
          setReads((prev) => {
            const cur = prev[row.user_id!];
            if (cur && parseTs(row.last_read_at!) <= parseTs(cur)) return prev;
            return { ...prev, [row.user_id!]: row.last_read_at! };
          });
        },
      )
      .subscribe((status) => {
        if (disposed || ch !== channel) return; // stale channel's echo
        if (status === "SUBSCRIBED") {
          joined = true;
          attempt = 0;
          // No replay on postgres_changes - refill whatever we missed.
          syncMessages();
          syncReactions();
          syncReads();
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
        rejoinNow();
      } else if (!joined) {
        rejoinNow();
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

  // Wake/network handlers. Visibility loss on a phone usually means the PWA
  // gets suspended - track how long we were hidden and do a hard transport
  // reset when it was long enough for the socket to have died underneath us.
  useEffect(() => {
    const hiddenAt = { t: null as number | null };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.t = Date.now();
        return;
      }
      const away = hiddenAt.t == null ? 0 : Date.now() - hiddenAt.t;
      hiddenAt.t = null;
      ensureLive.current(away > 15_000);
      syncMessages();
      syncReactions();
      syncReads();
    };
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      ensureLive.current(false);
      syncMessages();
      syncReactions();
      syncReads();
    };
    const onOnline = () => {
      ensureLive.current(false);
      syncMessages();
      syncReactions();
      syncReads();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [syncMessages, syncReactions, syncReads]);

  // Safety-net poll while the chat is open and visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        syncMessages();
        syncReactions();
        syncReads();
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [syncMessages, syncReactions, syncReads]);

  // Note how close to the bottom we are, so incoming messages don't yank the
  // view when the user has scrolled up to read history.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Auto-scroll on new messages: always for our own sends, otherwise only when
  // already pinned to the bottom.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.user_id === userId || atBottomRef.current) scrollToBottom();
  }, [messages, userId, scrollToBottom]);

  // Land at the bottom on first open.
  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep pinned to the bottom when the keyboard opens (the viewport shrinks).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (atBottomRef.current) scrollToBottom();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [scrollToBottom]);

  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // ── Reactions ─────────────────────────────────────────────────────────────

  const myReaction = useCallback(
    (mid: string) =>
      reactions.find((r) => r.message_id === mid && r.user_id === userId) ??
      null,
    [reactions, userId],
  );

  const toggleReaction = useCallback(
    async (msg: Message, emoji: string) => {
      if (msg.id.startsWith("temp-")) return;
      const supabase = createClient();
      const mine = myReaction(msg.id);

      if (mine && mine.emoji === emoji) {
        // Tap the same emoji again → remove (IG behavior).
        setReactions((prev) => prev.filter((r) => r !== mine));
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .eq("message_id", msg.id)
          .eq("user_id", userId);
        if (error) setReactions((prev) => [...prev, mine]);
        return;
      }

      // Add, or replace the previous emoji.
      const temp: Reaction = {
        id: `temp-${crypto.randomUUID()}`,
        message_id: msg.id,
        group_id: groupId,
        user_id: userId,
        emoji,
        created_at: new Date().toISOString(),
      };
      setReactions((prev) => [
        ...prev.filter(
          (r) => !(r.message_id === msg.id && r.user_id === userId),
        ),
        temp,
      ]);
      const { data, error } = await supabase
        .from("message_reactions")
        .upsert(
          { message_id: msg.id, group_id: groupId, user_id: userId, emoji },
          { onConflict: "message_id,user_id" },
        )
        .select("*")
        .single();
      setReactions((prev) => {
        const rest = prev.filter((r) => r.id !== temp.id);
        if (error || !data) return mine ? [...rest, mine] : rest;
        return [...rest, data as Reaction];
      });
    },
    [groupId, userId, myReaction],
  );

  // ── Message gestures ──────────────────────────────────────────────────────

  const openActions = useCallback((msg: Message, el: HTMLElement) => {
    if (msg.id.startsWith("temp-")) return;
    const r = el.getBoundingClientRect();
    navigator.vibrate?.(8);
    (document.activeElement as HTMLElement | null)?.blur();
    setAction({
      msg,
      anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    });
  }, []);

  const onBubbleTouchStart = (msg: Message) => (e: React.TouchEvent) => {
    const el = e.currentTarget as HTMLElement;
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => openActions(msg, el), LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const onBubbleClick = (msg: Message) => (e: React.MouseEvent) => {
    // Double-tap (touch fires click too) / double-click → ❤️, like IG.
    const now = Date.now();
    if (lastTap.current?.mid === msg.id && now - lastTap.current.t < 300) {
      lastTap.current = null;
      e.preventDefault();
      toggleReaction(msg, "❤️");
      return;
    }
    lastTap.current = { mid: msg.id, t: now };
  };

  const onBubbleContextMenu = (msg: Message) => (e: React.MouseEvent) => {
    e.preventDefault();
    openActions(msg, e.currentTarget as HTMLElement);
  };

  const scrollToMessage = useCallback((mid: string) => {
    const el = rowRefs.current.get(mid);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(mid);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1400);
  }, []);

  const startReply = useCallback(
    (msg: Message) => {
      if (msg.id.startsWith("temp-")) return;
      setReplyTo(msg);
      setAction(null);
      inputRef.current?.focus();
    },
    [],
  );

  // ── List swipes ───────────────────────────────────────────────────────────

  const onListTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const mid =
      (e.target as HTMLElement)
        .closest("[data-mid]")
        ?.getAttribute("data-mid") ?? null;
    drag.current = { x: t.clientX, y: t.clientY, axis: null, mid };
  };
  const onListTouchMove = (e: React.TouchEvent) => {
    const s = drag.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (s.axis === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (s.axis !== "x") return;
    cancelPress();
    if (dx < 0) {
      // reveal times
      setSwipeReply(null);
      setRevealX(Math.max(-64, dx));
    } else if (s.mid && !s.mid.startsWith("temp-")) {
      // drag a message right to reply
      setRevealX(0);
      setSwipeReply({ mid: s.mid, x: Math.min(dx, 80) });
    }
  };
  const onListTouchEnd = () => {
    const s = swipeReply;
    if (s && s.x >= SWIPE_REPLY_TRIGGER) {
      const msg = messageMap.get(s.mid);
      if (msg) {
        navigator.vibrate?.(8);
        startReply(msg);
      }
    }
    drag.current = null;
    setSwipeReply(null);
    setRevealX(0);
  };

  // Restore caret after inserting a mention.
  useEffect(() => {
    if (caretToSet.current != null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(
        caretToSet.current,
        caretToSet.current,
      );
      caretToSet.current = null;
    }
  }, [draft]);

  // null = the "@all" entry, listed first while the query could still be it.
  const suggestions = useMemo((): (GroupMember | null)[] => {
    if (!mentionQuery) return [];
    const q = mentionQuery.q.toLowerCase();
    const all =
      ALL_TOKEN.startsWith(q) || "everyone".startsWith(q) ? [null] : [];
    return [
      ...all,
      ...members.filter((m) => m.display_name.toLowerCase().includes(q)),
    ].slice(0, 5);
  }, [mentionQuery, members]);

  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (m) {
      setMentionQuery({ q: m[1], start: caret - m[1].length - 1 });
      setActiveIdx(0);
    } else {
      setMentionQuery(null);
    }
  };

  const pickMention = (member: GroupMember | null) => {
    if (!mentionQuery) return;
    const caret =
      inputRef.current?.selectionStart ??
      mentionQuery.start + mentionQuery.q.length + 1;
    const before = draft.slice(0, mentionQuery.start);
    const after = draft.slice(caret);
    const insert = `@${member ? member.display_name : ALL_TOKEN} `;
    const next = before + insert + after;
    caretToSet.current = (before + insert).length;
    setDraft(next);
    setMentionQuery(null);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    const mentionAll = ALL_RE.test(body);
    const mentioned = members
      .filter(
        (m) =>
          m.user_id !== userId &&
          (mentionAll || body.includes(`@${m.display_name}`)),
      )
      .map((m) => m.user_id);
    const replyId = replyTo && !replyTo.id.startsWith("temp-") ? replyTo.id : null;

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: tempId,
      group_id: groupId,
      user_id: userId,
      body,
      mentions: mentioned,
      reply_to: replyId,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setReplyTo(null);
    setMentionQuery(null);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .insert({
        group_id: groupId,
        user_id: userId,
        body,
        mentions: mentioned,
        reply_to: replyId,
      })
      .select("*")
      .single();

    if (error || !data) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      return;
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? (data as Message) : m)),
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(suggestions[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Escape" && replyTo) {
      setReplyTo(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /** "You replied to Yusuf" caption for a reply message. */
  const replyCaption = (msg: Message, original: Message | undefined) => {
    const replier =
      msg.user_id === userId ? "You" : firstName(memberMap.get(msg.user_id)?.display_name);
    if (!original) return `${replier} replied`;
    let target: string;
    if (original.user_id === userId) {
      target = msg.user_id === userId ? "yourself" : "you";
    } else if (original.user_id === msg.user_id) {
      target = msg.user_id === userId ? "yourself" : "themselves";
    } else {
      target = firstName(memberMap.get(original.user_id)?.display_name);
    }
    return `${replier} replied to ${target}`;
  };

  const reactorsList = reactorsFor ? (reactionsByMsg.get(reactorsFor) ?? []) : [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 pb-2 pt-3">
        <button
          onClick={() => setShowMembers(true)}
          className="min-w-0 flex-1 text-left"
        >
          <h1 className="truncate text-title3">{groupName}</h1>
          <p className="text-caption text-faint">
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>
        </button>
        <button
          onClick={() => setShowMembers(true)}
          aria-label="Group members"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"
        >
          <Users className="size-5" />
        </button>
      </header>

      <Sheet
        open={showMembers}
        onClose={() => setShowMembers(false)}
        labelledBy="members-title"
      >
        <div className="px-5 pt-2">
          <h2 id="members-title" className="text-title2">
            {groupName}
          </h2>
          <p className="mb-4 mt-0.5 text-footnote text-muted">
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>

          {/* Personal notification preference */}
          <div className="mb-4 flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1">
            <div className="min-w-0 flex-1">
              <p className="text-callout font-semibold">Message notifications</p>
              <p className="text-footnote text-muted">
                {notifyChat
                  ? "On: you're notified for new messages."
                  : "Off: only @mentions and replies notify you."}
              </p>
            </div>
            <button
              onClick={toggleNotifyChat}
              aria-pressed={notifyChat}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                notifyChat ? "bg-accent" : "bg-border",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all",
                  notifyChat ? "left-[1.375rem]" : "left-0.5",
                )}
              />
            </button>
          </div>

          {/* Owner-only: add members by name or email. */}
          {isOwner && (
            <div className="mb-4">
              <p className="mb-2 px-1 text-footnote font-medium uppercase tracking-wider text-faint">
                Add member
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="Search by name or email"
                  className="w-full rounded-xl bg-surface-2 py-2.5 pl-9 pr-3 text-callout text-foreground placeholder:text-faint outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>

              {memberQuery.trim() && (
                <div className="mt-2 space-y-1.5">
                  {searching && results.length === 0 ? (
                    <p className="px-1 py-2 text-footnote text-faint">
                      Searching…
                    </p>
                  ) : results.length === 0 ? (
                    <p className="px-1 py-2 text-footnote text-faint">
                      No one found.
                    </p>
                  ) : (
                    results.map((u) => (
                      <div
                        key={u.id}
                        className="flex items-center gap-3 rounded-2xl bg-surface p-2.5 shadow-e1"
                      >
                        <Avatar
                          name={u.display_name || u.email}
                          src={u.avatar_url}
                          size={36}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-subhead font-medium">
                            {u.display_name || "–"}
                          </p>
                          <p className="truncate text-caption text-faint">
                            {u.email}
                          </p>
                        </div>
                        {u.is_member ? (
                          <span className="shrink-0 px-2 text-footnote font-medium text-faint">
                            Added
                          </span>
                        ) : (
                          <button
                            onClick={() => addMember(u)}
                            disabled={addingId === u.id}
                            className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-footnote font-semibold text-on-accent transition active:scale-95 disabled:opacity-50"
                          >
                            <UserPlus className="size-3.5" strokeWidth={2.5} />
                            {addingId === u.id ? "Adding…" : "Add"}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <p className="mb-2 px-1 text-footnote font-medium uppercase tracking-wider text-faint">
            Members
          </p>
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.user_id}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-e1"
              >
                <Avatar name={m.display_name} src={m.avatar_url} size={40} />
                <span className="truncate text-callout font-medium">
                  {m.display_name}
                  {m.user_id === userId && (
                    <span className="text-faint"> (You)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Sheet>

      {/* Who reacted */}
      <Sheet
        open={reactorsFor !== null}
        onClose={() => setReactorsFor(null)}
        labelledBy="reactors-title"
      >
        <div className="px-5 pt-2">
          <h2 id="reactors-title" className="mb-4 text-title2">
            Reactions
          </h2>
          <div className="space-y-2 pb-2">
            {reactorsList.map((r) => {
              const m = memberMap.get(r.user_id);
              const mine = r.user_id === userId;
              const msg = reactorsFor ? messageMap.get(reactorsFor) : undefined;
              return (
                <button
                  key={r.user_id}
                  disabled={!mine}
                  onClick={() => {
                    if (mine && msg) {
                      toggleReaction(msg, r.emoji); // same emoji → removes
                      setReactorsFor(null);
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left shadow-e1"
                >
                  <Avatar
                    name={m?.display_name ?? "Member"}
                    src={m?.avatar_url}
                    size={40}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-callout font-medium">
                      {mine ? "You" : (m?.display_name ?? "Member")}
                    </p>
                    {mine && (
                      <p className="text-footnote text-faint">Tap to remove</p>
                    )}
                  </div>
                  <span className="text-[22px] leading-none">{r.emoji}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Sheet>

      {/* Long-press actions */}
      {action && (
        <ActionOverlay
          anchor={action.anchor}
          mine={action.msg.user_id === userId}
          myEmoji={myReaction(action.msg.id)?.emoji ?? null}
          onReact={(emoji) => {
            toggleReaction(action.msg, emoji);
            setAction(null);
          }}
          onReply={() => startReply(action.msg)}
          onCopy={() => {
            navigator.clipboard?.writeText(action.msg.body).catch(() => {});
            setAction(null);
          }}
          onClose={() => setAction(null)}
        />
      )}

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}
        style={{ touchAction: "pan-y" }}
        className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-xs text-center">
            <p className="text-callout font-semibold">No messages yet</p>
            <p className="mt-1 text-footnote text-muted">
              Say salaam to your circle. Use @ to tag someone.
            </p>
          </div>
        ) : (
          <div
            className="flex flex-col"
            style={{
              transform: `translateX(${revealX}px)`,
              transition:
                revealX === 0 ? "transform 220ms var(--ease-spring)" : "none",
            }}
          >
            {messages.map((msg, idx) => {
              const mine = msg.user_id === userId;
              const sender = memberMap.get(msg.user_id);
              const prev = messages[idx - 1];
              const next = messages[idx + 1];
              const gapPrev = prev
                ? new Date(msg.created_at).getTime() -
                  new Date(prev.created_at).getTime()
                : Infinity;
              const gapNext = next
                ? new Date(next.created_at).getTime() -
                  new Date(msg.created_at).getTime()
                : Infinity;
              const showStamp = gapPrev >= GAP_MS;
              const receipts = receiptsByMsg.get(msg.id) ?? [];
              // Group consecutive same-sender messages (within the hour). A
              // receipts row ends a group: its avatars sit between bubbles,
              // so the corners must close rather than claim connection.
              const sameAsPrev =
                !!prev &&
                prev.user_id === msg.user_id &&
                !showStamp &&
                (receiptsByMsg.get(prev.id)?.length ?? 0) === 0;
              const sameAsNext =
                !!next &&
                next.user_id === msg.user_id &&
                gapNext < GAP_MS &&
                receipts.length === 0;
              const firstOfGroup = !sameAsPrev;
              const lastOfGroup = !sameAsNext;
              const pending = msg.id.startsWith("temp-");
              const msgReactions = reactionsByMsg.get(msg.id) ?? [];
              const original = msg.reply_to
                ? messageMap.get(msg.reply_to)
                : undefined;
              const dragX = swipeReply?.mid === msg.id ? swipeReply.x : 0;
              return (
                <div
                  key={msg.id}
                  data-mid={msg.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(msg.id, el);
                    else rowRefs.current.delete(msg.id);
                  }}
                  className={cn(
                    sameAsPrev ? "mt-0.5" : "mt-3",
                    msgReactions.length > 0 && "mb-3",
                    "rounded-2xl transition-colors duration-700",
                    flashId === msg.id && "bg-accent-tint",
                  )}
                >
                  {showStamp && (
                    <div className="flex justify-center pb-2 pt-1">
                      <span className="text-[11px] font-medium text-faint">
                        {chatStamp(msg.created_at, tz)}
                      </span>
                    </div>
                  )}

                  {/* Reply context - IG puts the caption + quoted bubble above */}
                  {msg.reply_to && (
                    <div
                      className={cn(
                        "flex flex-col pt-1",
                        mine ? "items-end pr-1" : "items-start pl-9",
                      )}
                    >
                      <p className="mb-1 flex items-center gap-1 px-1 text-caption text-faint">
                        <Reply className="size-3" />
                        {replyCaption(msg, original)}
                      </p>
                      <button
                        onClick={() =>
                          original && scrollToMessage(original.id)
                        }
                        disabled={!original}
                        className={cn(
                          "-mb-1 max-w-[70%] rounded-2xl border-l-2 border-accent/50 bg-surface-2/70 px-3 py-1.5 text-left",
                          mine ? "mr-1" : "ml-1",
                        )}
                      >
                        <p className="line-clamp-2 text-footnote text-muted">
                          {original ? original.body : "Original message unavailable"}
                        </p>
                      </button>
                    </div>
                  )}

                  <div
                    className={cn(
                      "relative flex items-end gap-2",
                      mine ? "justify-end" : "justify-start",
                    )}
                    style={{
                      transform: dragX ? `translateX(${dragX}px)` : undefined,
                      transition: dragX
                        ? "none"
                        : "transform 220ms var(--ease-spring)",
                    }}
                  >
                    {/* Swipe-right reply affordance */}
                    <span
                      className="pointer-events-none absolute -left-9 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-surface-2 text-muted"
                      style={{ opacity: Math.min(1, dragX / SWIPE_REPLY_TRIGGER) }}
                    >
                      <Reply className="size-4" />
                    </span>

                    {!mine && (
                      <div className="w-7 shrink-0 self-end">
                        {lastOfGroup && (
                          <Avatar
                            name={sender?.display_name ?? "Member"}
                            src={sender?.avatar_url}
                            size={28}
                          />
                        )}
                      </div>
                    )}
                    <div
                      onTouchStart={onBubbleTouchStart(msg)}
                      onTouchMove={cancelPress}
                      onTouchEnd={cancelPress}
                      onClick={onBubbleClick(msg)}
                      onContextMenu={onBubbleContextMenu(msg)}
                      className={cn(
                        "relative max-w-[76%] select-none rounded-[20px] px-3.5 py-2 [-webkit-touch-callout:none]",
                        mine
                          ? "bg-accent text-on-accent"
                          : "bg-surface-2 text-foreground",
                        // Tighten the "spine" corners so a group reads as one stack.
                        mine && sameAsPrev && "rounded-tr-[7px]",
                        mine && sameAsNext && "rounded-br-[7px]",
                        !mine && sameAsPrev && "rounded-tl-[7px]",
                        !mine && sameAsNext && "rounded-bl-[7px]",
                        pending && "opacity-70",
                      )}
                    >
                      {!mine && firstOfGroup && (
                        <p className="mb-0.5 text-footnote font-semibold text-accent">
                          {sender?.display_name ?? "Member"}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                        <MessageBody
                          body={msg.body}
                          names={memberNames}
                          mine={mine}
                        />
                      </p>
                      <ReactionChips
                        reactions={msgReactions}
                        mine={mine}
                        onOpen={() => setReactorsFor(msg.id)}
                      />
                    </div>
                    {/* Time revealed by swiping the conversation left. */}
                    <span className="pointer-events-none absolute left-[calc(100%+1rem)] top-1/2 w-16 -translate-y-1/2 pr-3 text-right text-[11px] tabular-nums text-faint">
                      {pending ? "…" : timeLabel(msg.created_at, tz)}
                    </span>
                  </div>

                  {/* IG-style read receipts: tiny avatars of everyone whose
                      read frontier stops at this message, right-aligned. */}
                  {receipts.length > 0 && (
                    <div
                      className={cn(
                        "flex justify-end pr-1",
                        msgReactions.length > 0 ? "mt-4" : "mt-1",
                      )}
                      style={{
                        transform: dragX ? `translateX(${dragX}px)` : undefined,
                        transition: dragX
                          ? "none"
                          : "transform 220ms var(--ease-spring)",
                      }}
                    >
                      {receipts.map((m) => (
                        <Avatar
                          key={m.user_id}
                          name={m.display_name}
                          src={m.avatar_url}
                          size={18}
                          className="-ml-1.5 shrink-0 ring-2 ring-canvas first:ml-0"
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Composer */}
      <div
        {...swipeDown}
        className="relative border-t border-border bg-surface px-3 py-2.5"
      >
        {/* Mention typeahead */}
        {mentionQuery && suggestions.length > 0 && (
          <div className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl border border-border bg-surface shadow-e3">
            {suggestions.map((s, i) => (
              <button
                key={s?.user_id ?? "@all"}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(s);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === activeIdx ? "bg-accent-tint" : "",
                )}
              >
                {s ? (
                  <>
                    <Avatar
                      name={s.display_name}
                      src={s.avatar_url}
                      size={28}
                    />
                    <span className="text-callout font-medium">
                      {s.display_name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="grid size-7 place-items-center rounded-full bg-accent-tint text-accent">
                      <Users className="size-4" />
                    </span>
                    <span className="text-callout font-medium">@all</span>
                    <span className="text-footnote text-faint">
                      Everyone in the circle
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Replying-to bar */}
        {replyTo && (
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border-l-2 border-accent bg-surface-2 py-2 pl-3 pr-2">
            <div className="min-w-0 flex-1">
              <p className="text-caption font-semibold text-accent">
                Replying to{" "}
                {replyTo.user_id === userId
                  ? "yourself"
                  : firstName(memberMap.get(replyTo.user_id)?.display_name)}
              </p>
              <p className="truncate text-footnote text-muted">{replyTo.body}</p>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-muted"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) =>
              onDraftChange(e.target.value, e.target.selectionStart ?? 0)
            }
            onKeyDown={onKeyDown}
            placeholder={`Message ${groupName}…`}
            className="max-h-32 flex-1 resize-none rounded-2xl bg-surface-2 px-4 py-2.5 text-callout text-foreground placeholder:text-faint outline-none focus:ring-2 focus:ring-accent/20"
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            aria-label="Send"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent shadow-e2 transition active:scale-95 disabled:opacity-40 motion-reduce:active:scale-100"
          >
            <Send className="size-[18px]" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  );
}
