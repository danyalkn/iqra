import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSharedValue } from "react-native-reanimated";

import { Type } from "@/constants/theme";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { chatStamp, localDate, timeLabel } from "@/lib/dates";
import type { GroupMember, Message, Reaction } from "@/lib/types";

import type { Anchor } from "./ActionOverlay";
import { MessageRow, type RowMeta } from "./MessageRow";
import { GAP_MS, isTemp, LIST_PAD_RIGHT, replyCaption } from "./shared";

/** "Near the bottom" for auto-scroll on others' messages (web: 120px), kept
 *  current in onScroll. */
export const AT_BOTTOM_PX = 120;

/** Start at the bottom, as the web landed there on open. FlashList's own
 *  autoscrollToBottomThreshold is left at its default (-1, off): it is a
 *  ratio of the viewport, not pixels, and it would follow every data or
 *  height change on its own. Following new messages is the screen's job
 *  (ChatRoom's gated scrollToBottom and onKeyboardShown read atBottomRef),
 *  so a member reading history is never yanked down.
 *
 *  startRenderingFromBottom alone does not land at the bottom: FlashList
 *  treats it as initialScrollIndex = last item and scrolls to that item's
 *  TOP (from estimated sizes, retried only for 100 ms), and a scrollToEnd
 *  issued before the first layout runs against estimated content. The list
 *  therefore pins itself (see pinToEnd / onCommitLayoutEffect below). */
const MAINTAIN_POSITION = {
  startRenderingFromBottom: true,
};

/** After the first paint (FlashList's onLoad), every layout commit within
 *  this window that changes the content or viewport height re-pins the
 *  list to the bottom: measured row heights replace the estimates over a
 *  few commits, and on a cold start the safe-area insets (and with them the
 *  composer's bottom padding) can land after the first layout and shrink
 *  the viewport. The first drag ends the window early. */
const SETTLE_MS = 1000;

/** Sub-pixel noise in measured heights is not a change. */
const EPSILON = 0.5;

type PinState = {
  /** FlashList's onLoad has fired for the current FlashList instance. */
  loaded: boolean;
  /** Date.now() deadline for the settle window (see SETTLE_MS). */
  settleUntil: number;
  /** The member's finger is on the list: never scroll under it. */
  dragging: boolean;
  /** Content and viewport heights at the last commit, to spot changes. */
  contentH: number;
  windowH: number;
};

const initialPin = (): PinState => ({
  loaded: false,
  settleUntil: 0,
  dragging: false,
  contentH: -1,
  windowH: -1,
});

const keyExtractor = (m: Message) => m.id;

export type MessageListProps = {
  messages: Message[];
  userId: string;
  tz: string;
  memberMap: Map<string, GroupMember>;
  memberNames: string[];
  messageMap: Map<string, Message>;
  reactionsByMsg: Map<string, Reaction[]>;
  receiptsByMsg: Map<string, GroupMember[]>;
  flashId: string | null;
  listRef: RefObject<FlashListRef<Message> | null>;
  /** Kept current from onScroll; the screen reads it before auto-scrolling. */
  atBottomRef: RefObject<boolean>;
  /** Two taps on a bubble within 300 ms (web: ❤️, like IG). */
  onDoubleTap: (mid: string) => void;
  onLongPress: (mid: string, anchor: Anchor) => void;
  onSwipeReply: (mid: string) => void;
  onOpenReactors: (mid: string) => void;
  onQuotePress: (mid: string) => void;
};

/**
 * The scrolling conversation, ported from the messages map in
 * reference/web-pwa/app/(app)/chat/ChatClient.tsx. The web rendered every
 * row in one overflow-y div; native is a non-inverted FlashList that starts
 * at the bottom, so the per-row grouping rules are computed once here
 * (RowMeta) and rows only read them. Gestures live in MessageRow; the
 * list-level "reveal times" offset is a shared value every row translates by.
 */
export function MessageList({
  messages,
  userId,
  tz,
  memberMap,
  memberNames,
  messageMap,
  reactionsByMsg,
  receiptsByMsg,
  flashId,
  listRef,
  atBottomRef,
  onDoubleTap,
  onLongPress,
  onSwipeReply,
  onOpenReactors,
  onQuotePress,
}: MessageListProps) {
  const c = useTheme();
  // chatStamp says "Today" / "Yesterday" against the wall clock; keying the
  // row metadata on the local day makes the labels roll over at midnight
  // while the tab stays mounted (see useNow).
  const now = useNow();
  const today = localDate(now, tz);

  const meta = useMemo(() => {
    void today; // cache key only (chatStamp reads the clock itself)
    const nameOf = (id: string) => memberMap.get(id)?.display_name;
    const map = new Map<string, RowMeta>();
    for (let idx = 0; idx < messages.length; idx++) {
      const msg = messages[idx];
      const mine = msg.user_id === userId;
      const prev = messages[idx - 1];
      const next = messages[idx + 1];
      const gapPrev = prev
        ? new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()
        : Infinity;
      const gapNext = next
        ? new Date(next.created_at).getTime() - new Date(msg.created_at).getTime()
        : Infinity;
      const showStamp = gapPrev >= GAP_MS;
      const receipts = receiptsByMsg.get(msg.id) ?? [];
      // Group consecutive same-sender messages (within the hour). Receipts
      // no longer end a group: they sit in the gutter beside the bubble,
      // not between bubbles, and a read moving must not reshape corners.
      const sameAsPrev = !!prev && prev.user_id === msg.user_id && !showStamp;
      const sameAsNext = !!next && next.user_id === msg.user_id && gapNext < GAP_MS;
      const pending = isTemp(msg.id);
      const original = msg.reply_to ? messageMap.get(msg.reply_to) : undefined;
      map.set(msg.id, {
        mine,
        sender: memberMap.get(msg.user_id),
        stamp: showStamp ? chatStamp(msg.created_at, tz) : null,
        sameAsPrev,
        sameAsNext,
        firstOfGroup: !sameAsPrev,
        lastOfGroup: !sameAsNext,
        pending,
        reactions: reactionsByMsg.get(msg.id) ?? [],
        receipts,
        original,
        caption: msg.reply_to ? replyCaption(msg, original, userId, nameOf) : null,
        time: pending ? "…" : timeLabel(msg.created_at, tz),
        flash: flashId === msg.id,
      });
    }
    return map;
  }, [messages, memberMap, messageMap, reactionsByMsg, receiptsByMsg, userId, tz, today, flashId]);

  // Swipe-left reveals times (iMessage): one offset for every row.
  const revealX = useSharedValue(0);

  // Double-tap (two presses within 300 ms on the same bubble) → ❤️, like IG.
  const lastTap = useRef<{ mid: string; t: number } | null>(null);
  const handlePress = useCallback(
    (mid: string) => {
      const t = Date.now();
      const last = lastTap.current;
      if (last?.mid === mid && t - last.t < 300) {
        lastTap.current = null;
        onDoubleTap(mid);
        return;
      }
      lastTap.current = { mid, t };
    },
    [onDoubleTap],
  );

  // Note how close to the bottom we are, so incoming messages don't yank the
  // view when the user has scrolled up to read history.
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      atBottomRef.current =
        contentSize.height - contentOffset.y - layoutMeasurement.height < AT_BOTTOM_PX;
    },
    [atBottomRef],
  );

  // ── Pinned to the bottom on open ─────────────────────────────────────────
  const pin = useRef<PinState>(initialPin());
  const empty = messages.length === 0;
  // The empty state unmounts the FlashList; the next one is a new instance
  // whose own onLoad must run before any commit is trusted.
  useEffect(() => {
    if (empty) pin.current = initialPin();
  }, [empty]);

  /** Jump (no animation) to the true end of the content, and remember the
   *  heights it was pinned at. FlashList's scrollToEnd first brings the last
   *  row into the render window, then calls the native scrollToEnd on the
   *  next tick, which reads the committed native content size. */
  const pinToEnd = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    pin.current.contentH = list.getChildContainerDimensions().height;
    pin.current.windowH = list.getWindowSize().height;
    atBottomRef.current = true;
    list.scrollToEnd({ animated: false });
  }, [listRef, atBottomRef]);

  // First paint: the layout manager exists and the visible rows are
  // measured, so this is the first moment a scrollToEnd means "the end".
  const onLoad = useCallback(() => {
    pin.current.loaded = true;
    pin.current.settleUntil = Date.now() + SETTLE_MS;
    pinToEnd();
  }, [pinToEnd]);

  // Every FlashList layout commit (rows measured, viewport resized). Rules:
  // - before onLoad: FlashList's own startRenderingFromBottom pass owns the
  //   offset, and the layout manager may not exist yet;
  // - never while the member is dragging;
  // - inside the settle window: re-pin on any content or viewport change;
  // - afterwards: re-pin only when the viewport SHRINKS (composer grew, a
  //   reply bar appeared, late insets, the keyboard rising) while the member
  //   was at the bottom, so the newest row is not pushed under the composer.
  //   Content growth after the window (a new message, a reaction) is left
  //   to the screen's gated follow, so reading history is never interrupted.
  const onCommitLayoutEffect = useCallback(() => {
    const list = listRef.current;
    const p = pin.current;
    if (!list || !p.loaded || p.dragging) return;
    const contentH = list.getChildContainerDimensions().height;
    const windowH = list.getWindowSize().height;
    const contentChanged = Math.abs(contentH - p.contentH) > EPSILON;
    const windowChanged = Math.abs(windowH - p.windowH) > EPSILON;
    const windowShrank = p.windowH - windowH > EPSILON;
    const repin =
      Date.now() < p.settleUntil
        ? contentChanged || windowChanged
        : windowShrank && atBottomRef.current;
    if (repin) {
      pinToEnd();
    } else {
      p.contentH = contentH;
      p.windowH = windowH;
    }
  }, [listRef, atBottomRef, pinToEnd]);

  const onScrollBeginDrag = useCallback(() => {
    pin.current.dragging = true;
    // The member took over: the settle window is over.
    pin.current.settleUntil = 0;
  }, []);
  const onScrollEndDrag = useCallback(() => {
    pin.current.dragging = false;
  }, []);

  // FlashList is a PureComponent: anything renderItem reads besides `data`
  // goes through extraData so a reaction, receipt or flash re-renders rows.
  const extra = useMemo(() => ({ meta, memberNames }), [meta, memberNames]);

  const renderItem = useCallback(
    ({ item, extraData }: ListRenderItemInfo<Message>) => {
      const { meta: rows, memberNames: names } = extraData as typeof extra;
      const m = rows.get(item.id);
      if (!m) return null;
      return (
        <MessageRow
          msg={item}
          meta={m}
          memberNames={names}
          revealX={revealX}
          onPress={handlePress}
          onLongPress={onLongPress}
          onSwipeReply={onSwipeReply}
          onOpenReactors={onOpenReactors}
          onQuotePress={onQuotePress}
        />
      );
    },
    [revealX, handlePress, onLongPress, onSwipeReply, onOpenReactors, onQuotePress],
  );

  if (empty) {
    return (
      <View style={styles.empty}>
        <Text style={[Type.callout, styles.emptyTitle, { color: c.foreground }]}>
          No messages yet
        </Text>
        <Text style={[Type.footnote, styles.emptyNote, { color: c.muted }]}>
          Say salaam to your circle. Use @ to tag someone.
        </Text>
      </View>
    );
  }

  return (
    <FlashList
      ref={listRef}
      data={messages}
      extraData={extra}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      maintainVisibleContentPosition={MAINTAIN_POSITION}
      style={styles.list}
      contentContainerStyle={styles.content}
      onLoad={onLoad}
      onCommitLayoutEffect={onCommitLayoutEffect}
      onScroll={onScroll}
      onScrollBeginDrag={onScrollBeginDrag}
      onScrollEndDrag={onScrollEndDrag}
      scrollEventThrottle={32}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      // The screen pads the tab bar and keyboard itself; keep
      // react-native-screens' automatic-inset flip off this scroll view.
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  // Web: px-4 py-4 on the scroller. The bottom padding is only the web's
  // breathing room under the last bubble: the list is a flex sibling ABOVE
  // the composer (not under it) inside a KeyboardAvoidingView that pads for
  // the keyboard, so neither takes space inside this scroll view.
  // The right side is narrower because every row keeps its own receipt
  // gutter (MessageRow), which already spaces the bubbles off the edge.
  content: { paddingLeft: 16, paddingRight: LIST_PAD_RIGHT, paddingVertical: 16 },
  // Web: m-auto max-w-xs text-center.
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  emptyTitle: { fontWeight: "600", textAlign: "center", maxWidth: 320 },
  emptyNote: { marginTop: 4, textAlign: "center", maxWidth: 320 },
});
