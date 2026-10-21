import type { FlashListRef } from "@shopify/flash-list";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { MessageCircle, Users, WifiOff } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  KeyboardAvoidingView,
  useKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { ActionOverlay, type Anchor } from "@/components/chat/ActionOverlay";
import type { ChatMessage } from "@/components/chat/contracts";
import { ImageViewer } from "@/components/chat/ImageViewer";
import { Composer } from "@/components/chat/Composer";
import { MembersSheet } from "@/components/chat/MembersSheet";
import { MessageList } from "@/components/chat/MessageList";
import { ReactorsSheet } from "@/components/chat/ReactorsSheet";
import { isTemp, parseTs, tempId } from "@/components/chat/shared";
import { useChatSync } from "@/components/chat/useChatSync";
import { EmptyState } from "@/components/EmptyState";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import {
  chatImageSource,
  deleteChatImage,
  uploadChatImage,
  type PickedImage,
} from "@/data/chatImages";
import { useMembership } from "@/hooks/use-membership";
import { useTabBarClearance } from "@/hooks/use-tab-bar-clearance";
import { useTheme } from "@/hooks/use-theme";
import type { ChatRead, GroupMember, Membership, Message, Reaction } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

/** Members and read frontiers before the room mounts: not landed, landed,
 *  or failed before ever landing. */
type LoadState = "loading" | "ready" | "failed";

/** Extra space between the field row and the open keyboard. 0: the composer
 *  already keeps the web's py-2.5 (10) under the field on top of
 *  `bottomPadding`, and that is the gap the web had above the keyboard. */
const KEYBOARD_GAP = 0;

/**
 * Keeps the composer on the keyboard. The screen runs to the window bottom
 * under the floating tab bar on both platforms, and the composer pads the
 * bar clearance itself while the keyboard is closed.
 *
 * iOS: keyboard-controller's KeyboardAvoidingView, which pads by
 * (keyboard height + keyboardVerticalOffset); the negative offset of
 * (clearance - gap) makes that padding plus the composer's own clearance
 * end KEYBOARD_GAP above the keyboard. Verified on the owner's phone.
 *
 * Android: a plain animated pad. The KeyboardAvoidingView derives its
 * padding from a frame it measures at mount plus an async window position
 * (automaticOffset), and on the emulator that frame came out 112 dp short
 * in some runs (2026-10-20), which left the field under the keyboard with
 * no way to tell from the code. Nothing here needs measuring: the pad is
 * the keyboard height less the bar clearance, so the field ends
 * KEYBOARD_GAP above the keyboard while the glass bar is off screen.
 */
function KeyboardSpace({ clearance, children }: { clearance: number; children: ReactNode }) {
  if (Platform.OS === "android") {
    return <AndroidKeyboardPad clearance={clearance}>{children}</AndroidKeyboardPad>;
  }
  return (
    <KeyboardAvoidingView
      behavior="padding"
      automaticOffset
      keyboardVerticalOffset={KEYBOARD_GAP - clearance}
      style={styles.flex}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

function AndroidKeyboardPad({ clearance, children }: { clearance: number; children: ReactNode }) {
  // keyboard-controller reports the keyboard's height from the window
  // bottom (negative while it is up, in the reanimated context).
  const { height } = useReanimatedKeyboardAnimation();
  const pad = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, Math.abs(height.get()) - clearance + KEYBOARD_GAP),
  }));
  return <Animated.View style={[styles.flex, pad]}>{children}</Animated.View>;
}

const SEND_ERROR = "Couldn’t send that message. Check your connection and try again.";
const STALE_ERROR = "Can’t reach the chat right now. Retrying…";

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function tapHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Native-side reads that keep the error. getGroupMembers / getGroupChatReads
 *  in src/lib/data.ts (kept verbatim with the web) collapse a failed request
 *  into [], so a dropped connection would read as "0 members" and no names.
 *  The web could live with that: its server re-ran the queries on every
 *  visit. Same selects and filters as the lib helpers. */
async function fetchGroupMembers(groupId: string): Promise<GroupMember[] | null> {
  const { data: rows, error } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  if (error) return null;
  const ids = ((rows as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  if (profileError) return null;
  const byId = new Map(
    (
      (profiles as
        | { id: string; display_name: string | null; avatar_url: string | null }[]
        | null) ?? []
    ).map((p) => [p.id, p]),
  );
  return ids.map((id) => ({
    user_id: id,
    display_name: byId.get(id)?.display_name ?? "Member",
    avatar_url: byId.get(id)?.avatar_url ?? null,
  }));
}

async function fetchGroupChatReads(groupId: string): Promise<ChatRead[] | null> {
  const { data, error } = await supabase
    .from("chat_reads")
    .select("user_id, last_read_at")
    .eq("group_id", groupId);
  if (error) return null;
  return (data as ChatRead[] | null) ?? [];
}

/** getMyMembership (src/lib/data.ts) with the error kept: undefined when the
 *  read failed, null only for a confirmed "no circle". useMembership no
 *  longer caches a failed read (it stays undefined with `failed` set), so this
 *  second opinion only matters for a null that arrived while the chat was
 *  already showing the placeholder; kept as belt and braces, same select as
 *  the helper plus one token refresh. */
async function fetchMyMembership(): Promise<Membership | null | undefined> {
  const read = () =>
    supabase
      .from("group_members")
      .select("group_id, role, groups(name)")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();
  let { data, error } = await read();
  if (error || !data) {
    // Refresh an expired token, then ask once more; no session at all means
    // the anon key answered, which says nothing about membership.
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) return undefined;
    ({ data, error } = await read());
  }
  if (error) return undefined;
  if (!data) return null;
  const group = data.groups as unknown as { name: string } | null;
  return {
    group_id: data.group_id as string,
    group_name: group?.name ?? "Your circle",
    role: (data.role as string) ?? "member",
  };
}

function sameMembers(a: GroupMember[], b: GroupMember[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (m, i) =>
        m.user_id === b[i].user_id &&
        m.display_name === b[i].display_name &&
        m.avatar_url === b[i].avatar_url,
    )
  );
}

/**
 * Chat tab (reference/web-pwa/app/(app)/chat/page.tsx + ChatClient.tsx).
 *
 * The web page fetched membership, members, messages, reactions and reads
 * on the server and handed them to the client as props. Native resolves
 * membership first (the circle gate), then members + reads (ChatLoader),
 * then the room runs the same three syncs the web ran on every rejoin.
 */
export default function ChatScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile } = useSession();
  const { membership: shared, refresh } = useMembership();
  // A circle NoCircleCheck found after the shared cache said "none".
  const [found, setFound] = useState<Membership | null>(null);
  const membership = shared ?? (shared === null ? found : undefined);
  const tz = profile?.timezone || deviceTimeZone();

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.canvas }]}>
      {membership === null ? (
        <NoCircleCheck onFound={setFound} refresh={refresh} />
      ) : !membership || !user ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.muted} />
        </View>
      ) : (
        // Keyed so a different circle (owner moved this member) starts over
        // rather than merging two chats.
        <ChatLoader
          key={membership.group_id}
          groupId={membership.group_id}
          groupName={membership.group_name}
          isOwner={membership.role === "owner"}
          userId={user.id}
          tz={tz}
        />
      )}
    </View>
  );
}

type CheckState = "checking" | "failed" | "none";

/** The shared membership cache said "no circle". That null may be a failed
 *  read (the lib helper drops the error), so confirm it with a read that keeps
 *  the error before telling a member to ask to be added: a failure gets the
 *  retry view, a circle found is handed up (and the shared cache refreshed),
 *  and only a confirmed null shows the Placeholder. Re-checked on foreground
 *  return and on focus, since the owner adds people in SQL. */
function NoCircleCheck({
  onFound,
  refresh,
}: {
  onFound: (m: Membership) => void;
  refresh: () => Promise<Membership | null>;
}) {
  const c = useTheme();
  const [state, setState] = useState<CheckState>("checking");
  // Only the newest check may land.
  const seq = useRef(0);

  const check = useCallback((): Promise<void> => {
    const mine = ++seq.current;
    return fetchMyMembership().then((m) => {
      if (mine !== seq.current) return;
      if (m === undefined) {
        setState("failed");
      } else if (m === null) {
        setState("none");
      } else {
        onFound(m);
        void refresh().catch(() => {});
      }
    });
  }, [onFound, refresh]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check();
    });
    return () => sub.remove();
  }, [check]);
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      // The mount effect covered the first focus.
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void check();
    }, [check]),
  );

  const retry = useCallback(() => {
    setState("checking");
    void check();
  }, [check]);

  if (state === "failed") return <LoadFailed onRetry={retry} />;
  if (state === "none") {
    return (
      <Placeholder
        icon={MessageCircle}
        title="Chat"
        note="You’re not in a circle yet. Ask the group owner to add you, then your shared chat shows up here."
      />
    );
  }
  return (
    <View style={styles.center}>
      <ActivityIndicator color={c.muted} />
    </View>
  );
}

type RoomIdentity = {
  groupId: string;
  groupName: string;
  isOwner: boolean;
  userId: string;
  tz: string;
};

/** Loads what the web page fetched before rendering ChatClient (members,
 *  read frontiers) and mounts the room once both are known. */
function ChatLoader(props: RoomIdentity) {
  const { groupId, groupName } = props;
  const c = useTheme();
  const [boot, setBoot] = useState<{ members: GroupMember[]; reads: ChatRead[] } | null>(null);
  const [bootState, setBootState] = useState<LoadState>("loading");
  // The current state for the focus / foreground retries, which must not
  // re-subscribe when it changes.
  const bootStateRef = useRef<LoadState>("loading");
  useEffect(() => {
    bootStateRef.current = bootState;
  }, [bootState]);
  // Only the newest request may land.
  const seq = useRef(0);

  const load = useCallback((): Promise<void> => {
    const mine = ++seq.current;
    return Promise.all([fetchGroupMembers(groupId), fetchGroupChatReads(groupId)]).then(
      ([members, reads]) => {
        if (mine !== seq.current) return;
        if (!members || !reads) {
          setBootState("failed");
          return;
        }
        setBoot({ members, reads });
        setBootState("ready");
      },
    );
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A load that never landed gets another go on foreground return and on
  // the tab coming back.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && bootStateRef.current === "failed") void load();
    });
    return () => sub.remove();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      if (bootStateRef.current === "failed") void load();
    }, [load]),
  );

  const retry = useCallback(() => {
    setBootState("loading");
    void load();
  }, [load]);

  if (boot && bootState === "ready") {
    return <ChatRoom {...props} initialMembers={boot.members} initialReads={boot.reads} />;
  }
  return (
    <>
      <ChatHeader groupName={groupName} memberCount={null} />
      {bootState === "failed" ? (
        <LoadFailed onRetry={retry} />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={c.muted} />
        </View>
      )}
    </>
  );
}

/** Group name + member count (opens the members sheet) and the Users button.
 *  Web: the header in ChatClient. */
function ChatHeader({
  groupName,
  memberCount,
  onPress,
}: {
  groupName: string;
  /** null while members are still loading. */
  memberCount: number | null;
  onPress?: () => void;
}) {
  const c = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        disabled={!onPress}
        style={styles.headerText}
      >
        <Text numberOfLines={1} style={[Type.title3, { color: c.foreground }]}>
          {groupName}
        </Text>
        <Text style={[Type.caption, { color: c.faint }]}>
          {memberCount === null
            ? " "
            : `${memberCount} ${memberCount === 1 ? "member" : "members"}`}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Group members"
        onPress={onPress}
        disabled={!onPress}
        hitSlop={8}
        style={[styles.headerButton, { backgroundColor: c.surface2 }]}
      >
        <Users size={20} color={c.muted} />
      </Pressable>
    </View>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.center}>
      <EmptyState
        icon={WifiOff}
        title="Couldn’t load the chat"
        note="Check your connection and try again."
        style={styles.failed}
      />
      <Button variant="secondary" size="md" onPress={onRetry} style={styles.retry}>
        Try again
      </Button>
    </View>
  );
}

/** The chat proper: ChatClient's state, derived maps, reactions, replies,
 *  sends and overlays, over the list and composer halves. */
function ChatRoom({
  groupId,
  groupName,
  isOwner,
  userId,
  tz,
  initialMembers,
  initialReads,
}: RoomIdentity & { initialMembers: GroupMember[]; initialReads: ChatRead[] }) {
  const c = useTheme();
  const barClearance = useTabBarClearance();
  const [members, setMembers] = useState<GroupMember[]>(initialMembers);
  const { messages, setMessages, reactions, setReactions, reads, loadState, stale, retry } =
    useChatSync({ groupId, userId, initialReads });

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // Bumped to focus the composer after a swipe or a long-press Reply.
  const [focusRequest, setFocusRequest] = useState(0);
  // Long-press action overlay.
  const [action, setAction] = useState<{ msg: ChatMessage; anchor: Anchor } | null>(null);
  // The picture open full screen, by message id (one viewer for the screen),
  // and the token stored pictures are fetched with.
  const [photoOf, setPhotoOf] = useState<string | null>(null);
  const { session } = useSession();
  // "Who reacted" sheet. `frozen` is the list shown while the sheet slides
  // out (CLOSE_MS), so the rows do not vanish before the panel does.
  const [reactors, setReactors] = useState<{
    mid: string;
    open: boolean;
    frozen: Reaction[];
  } | null>(null);
  // Briefly highlight a message after jumping to it from a reply quote.
  const [flashId, setFlashId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  // The web dropped a failed send silently; native says so (the draft is
  // already gone, as it was on the web).
  const [sendError, setSendError] = useState<string | null>(null);

  const listRef = useRef<FlashListRef<ChatMessage>>(null);
  const atBottomRef = useRef(true);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  // The web re-read the members on every page visit; a resident tab
  // refreshes them on focus (the owner adds people in SQL) and keeps the
  // list it has when the read fails. The loader covered the first focus.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      let active = true;
      void fetchGroupMembers(groupId).then((rows) => {
        if (!active || !rows) return;
        setMembers((prev) => (sameMembers(prev, rows) ? prev : rows));
      });
      return () => {
        active = false;
      };
    }, [groupId]),
  );

  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const memberNames = useMemo(() => members.map((m) => m.display_name), [members]);
  const messageMap = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const reactionsByMsg = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) {
      (map.get(r.message_id) ?? map.set(r.message_id, []).get(r.message_id)!).push(r);
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
        if (isTemp(msg.id)) continue;
        if (parseTs(msg.created_at) <= frontier) {
          (map.get(msg.id) ?? map.set(msg.id, []).get(msg.id)!).push(m);
          break;
        }
      }
    }
    return map;
  }, [members, reads, messages, userId]);

  const scrollToBottom = useCallback((animated = true) => {
    // Next frame, as the web did, so the appended row has a layout.
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
      atBottomRef.current = true;
    });
  }, []);

  // Auto-scroll on new messages: always for our own sends, otherwise only
  // when already within AT_BOTTOM_PX of the bottom (the web's rule; this is
  // the only follow, FlashList's own autoscroll is off). The first batch is
  // NOT scrolled from here: this effect runs before FlashList has measured
  // a single row, so a scrollToEnd now lands against estimated heights and
  // stops short. MessageList pins itself to the true bottom from FlashList's
  // onLoad and keeps it there while the first layouts settle (the web
  // landed at the bottom on open); this only records that we start there.
  const firstScroll = useRef(true);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (firstScroll.current) {
      firstScroll.current = false;
      atBottomRef.current = true;
      return;
    }
    if (last.user_id === userId || atBottomRef.current) scrollToBottom();
  }, [messages, userId, scrollToBottom]);

  // Keep pinned to the bottom when the keyboard opens (the list shrinks).
  // Web: visualViewport resize.
  const onKeyboardShown = useCallback(() => {
    if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: true });
  }, []);
  useKeyboardHandler(
    {
      onEnd: (e) => {
        "worklet";
        if (e.progress === 1) scheduleOnRN(onKeyboardShown);
      },
    },
    [onKeyboardShown],
  );

  // ── Reactions ─────────────────────────────────────────────────────────────

  const myReaction = useCallback(
    (mid: string) =>
      reactions.find((r) => r.message_id === mid && r.user_id === userId) ?? null,
    [reactions, userId],
  );

  const toggleReaction = useCallback(
    async (msg: Message, emoji: string) => {
      if (isTemp(msg.id)) return;
      const mine = myReaction(msg.id);
      // One write per message at a time: while my upsert is in flight a
      // delete would match no row and the upsert would then bring the
      // reaction back, so a tap on a pending reaction is ignored.
      if (mine && isTemp(mine.id)) return;
      tapHaptic();
      // Every row of mine on this message (a sync can swap in a new object
      // for the same reaction, so match by message + user, not identity).
      const notMine = (r: Reaction) => !(r.message_id === msg.id && r.user_id === userId);

      if (mine && mine.emoji === emoji) {
        // Tap the same emoji again → remove (IG behavior).
        setReactions((prev) => prev.filter(notMine));
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .eq("message_id", msg.id)
          .eq("user_id", userId);
        if (error) setReactions((prev) => [...prev.filter(notMine), mine]);
        return;
      }

      // Add, or replace the previous emoji.
      const temp: Reaction = {
        id: tempId(),
        message_id: msg.id,
        group_id: groupId,
        user_id: userId,
        emoji,
        created_at: new Date().toISOString(),
      };
      setReactions((prev) => [...prev.filter(notMine), temp]);
      const { data, error } = await supabase
        .from("message_reactions")
        .upsert(
          { message_id: msg.id, group_id: groupId, user_id: userId, emoji },
          { onConflict: "message_id,user_id" },
        )
        .select("*")
        .single();
      setReactions((prev) => {
        // Drop the temp and any copy of my row a sync merged in meanwhile, so
        // the settled row is the only one (no doubled chip or reactor).
        const rest = prev.filter(notMine);
        if (error || !data) return mine ? [...rest, mine] : rest;
        return [...rest, data as Reaction];
      });
    },
    [groupId, userId, myReaction, setReactions],
  );

  // ── Message gestures ──────────────────────────────────────────────────────

  const openActions = useCallback(
    (mid: string, anchor: Anchor) => {
      const msg = messageMap.get(mid);
      if (!msg || isTemp(msg.id)) return;
      tapHaptic();
      // Web: blur the active element so the keyboard drops under the overlay.
      Keyboard.dismiss();
      setAction({ msg, anchor });
    },
    [messageMap],
  );

  const scrollToMessage = useCallback(
    (mid: string) => {
      const index = messages.findIndex((m) => m.id === mid);
      if (index < 0) return;
      void listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
      setFlashId(mid);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), 1400);
    },
    [messages],
  );

  const startReply = useCallback((msg: ChatMessage) => {
    if (isTemp(msg.id)) return;
    setReplyTo(msg);
    setAction(null);
    setFocusRequest((n) => n + 1);
  }, []);

  const onSwipeReply = useCallback(
    (mid: string) => {
      const msg = messageMap.get(mid);
      if (!msg || isTemp(msg.id)) return;
      tapHaptic();
      startReply(msg);
    },
    [messageMap, startReply],
  );

  const onDoubleTap = useCallback(
    (mid: string) => {
      const msg = messageMap.get(mid);
      if (msg) void toggleReaction(msg, "❤️");
    },
    [messageMap, toggleReaction],
  );

  const openReactors = useCallback(
    (mid: string) => setReactors({ mid, open: true, frozen: [] }),
    [],
  );
  const cancelReply = useCallback(() => setReplyTo(null), []);

  // ── Send ──────────────────────────────────────────────────────────────────

  const send = useCallback(
    async (body: string, mentions: string[], replyId: string | null, image: PickedImage | null) => {
      const id = tempId();
      const optimistic: ChatMessage = {
        id,
        group_id: groupId,
        user_id: userId,
        body,
        mentions,
        reply_to: replyId,
        created_at: new Date().toISOString(),
        image_path: null,
        image_w: image?.width ?? null,
        image_h: image?.height ?? null,
        local_image: image?.uri,
      };
      setMessages((prev) => [...prev, optimistic]);
      setSendError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      const fail = () => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
        setSendError(SEND_ERROR);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      };

      // The picture goes up first, under the group's folder; the row then
      // points at it. The optimistic row shows the local copy meanwhile.
      let imagePath: string | null = null;
      if (image) {
        try {
          imagePath = await uploadChatImage(groupId, image);
        } catch (e) {
          console.warn("Photo upload failed", e);
          fail();
          return;
        }
      }

      const { data, error } = await supabase
        .from("messages")
        .insert({
          group_id: groupId,
          user_id: userId,
          body,
          mentions,
          reply_to: replyId,
          image_path: imagePath,
          image_w: image?.width ?? null,
          image_h: image?.height ?? null,
        })
        .select("*")
        .single();

      if (error || !data) {
        // Only a refusal from the server leaves a sure orphan; a reply lost
        // on the way (no code) may well have a row behind it, and deleting
        // the object would leave everyone a grey box under a "Photo" push.
        if (imagePath && error?.code) void deleteChatImage(imagePath);
        fail();
        return;
      }
      // Keep showing the copy on this phone: the row is identical to the one
      // in the bucket, so no download for the sender. The next sync replaces
      // the row with the server's and the cached copy takes over from there.
      const saved: ChatMessage = { ...(data as ChatMessage), local_image: image?.uri };
      // A sync that landed between the commit and this response already
      // merged the server row next to the temp; then just drop the temp, so
      // no id appears twice (FlashList keys and the row maps assume unique).
      setMessages((prev) =>
        prev.some((m) => m.id === saved.id)
          ? prev.filter((m) => m.id !== id)
          : prev.map((m) => (m.id === id ? saved : m)),
      );
    },
    [groupId, userId, setMessages],
  );

  const reactorsList = reactors
    ? reactors.open
      ? (reactionsByMsg.get(reactors.mid) ?? [])
      : reactors.frozen
    : [];
  // Freeze what is on screen, then close.
  const closeReactors = useCallback(
    () =>
      setReactors((cur) =>
        cur?.open ? { ...cur, open: false, frozen: reactionsByMsg.get(cur.mid) ?? [] } : cur,
      ),
    [reactionsByMsg],
  );
  const removeMyReaction = useCallback(
    (r: Reaction) => {
      // Close first so the frozen list still holds the row being removed.
      closeReactors();
      const msg = reactors ? messageMap.get(reactors.mid) : undefined;
      if (msg) void toggleReaction(msg, r.emoji); // same emoji → removes
    },
    [reactors, messageMap, toggleReaction, closeReactors],
  );

  // The composer carries the bar clearance (useTabBarClearance) while the
  // keyboard is closed; KeyboardSpace lifts it onto the keyboard.
  const bottomPadding = barClearance;

  const banner = sendError ?? (loadState === "ready" && stale ? STALE_ERROR : null);

  return (
    <>
      <ChatHeader
        groupName={groupName}
        memberCount={members.length}
        onPress={() => setShowMembers(true)}
      />

      <KeyboardSpace clearance={barClearance}>
        {banner && (
          <View style={[styles.banner, { backgroundColor: c.dangerTint }]}>
            <Text style={[Type.footnote, { color: c.danger }]}>{banner}</Text>
          </View>
        )}

        <View style={styles.flex}>
          {loadState === "loading" ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.muted} />
            </View>
          ) : loadState === "failed" ? (
            <LoadFailed onRetry={retry} />
          ) : (
            <MessageList
              messages={messages}
              userId={userId}
              tz={tz}
              memberMap={memberMap}
              memberNames={memberNames}
              messageMap={messageMap}
              reactionsByMsg={reactionsByMsg}
              receiptsByMsg={receiptsByMsg}
              flashId={flashId}
              listRef={listRef}
              atBottomRef={atBottomRef}
              onDoubleTap={onDoubleTap}
              onLongPress={openActions}
              onSwipeReply={onSwipeReply}
              onOpenReactors={openReactors}
              onQuotePress={scrollToMessage}
              onOpenPhoto={setPhotoOf}
              accessToken={session?.access_token ?? null}
            />
          )}
        </View>

        <Composer
          groupName={groupName}
          members={members}
          userId={userId}
          replyTo={replyTo}
          onCancelReply={cancelReply}
          onSend={send}
          focusRequest={focusRequest}
          bottomPadding={bottomPadding}
        />
      </KeyboardSpace>

      <MembersSheet
        open={showMembers}
        onClose={() => setShowMembers(false)}
        groupId={groupId}
        groupName={groupName}
        userId={userId}
        isOwner={isOwner}
        members={members}
        onMembersChange={setMembers}
      />

      <ReactorsSheet
        open={reactors?.open ?? false}
        onClose={closeReactors}
        reactions={reactorsList}
        memberMap={memberMap}
        userId={userId}
        onRemoveMine={removeMyReaction}
      />

      {/* One viewer for the whole screen, so a recycled row never keeps a
          picture open. */}
      <ImageViewer
        source={(() => {
          const m = photoOf ? messageMap.get(photoOf) : undefined;
          if (!m) return null;
          if (m.local_image) return { uri: m.local_image };
          return m.image_path ? chatImageSource(m.image_path, session?.access_token ?? null) : null;
        })()}
        onClose={() => setPhotoOf(null)}
      />
      {action && (
        <ActionOverlay
          anchor={action.anchor}
          mine={action.msg.user_id === userId}
          myEmoji={myReaction(action.msg.id)?.emoji ?? null}
          onReact={(emoji) => {
            void toggleReaction(action.msg, emoji);
            setAction(null);
          }}
          onReply={() => startReply(action.msg)}
          onCopy={
            action.msg.body
              ? () => {
                  void Clipboard.setStringAsync(action.msg.body).catch(() => {});
                  setAction(null);
                }
              : null
          }
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Web: flex items-center gap-3 border-b border-border px-4 pb-2 pt-3.
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, minWidth: 0 },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  failed: { paddingTop: 0 },
  retry: { marginTop: 16 },
  banner: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
