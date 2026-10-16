import { FlashList, type FlashListRef, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useMemo, useRef, type RefObject } from "react";
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
import { GAP_MS, isTemp, replyCaption } from "./shared";

/** "Near the bottom" for auto-scroll on others' messages (web: 120px), kept
 *  current in onScroll. */
export const AT_BOTTOM_PX = 120;

/** Start at the bottom, as the web landed there on open. FlashList's own
 *  autoscrollToBottomThreshold is left at its default (-1, off): it is a
 *  ratio of the viewport, not pixels, and it would follow every data or
 *  height change on its own. Following is the screen's job (ChatRoom's
 *  gated scrollToBottom and onKeyboardShown read atBottomRef), so a member
 *  reading history is never yanked down. */
const MAINTAIN_POSITION = {
  startRenderingFromBottom: true,
};

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
      // Group consecutive same-sender messages (within the hour). A
      // receipts row ends a group: its avatars sit between bubbles,
      // so the corners must close rather than claim connection.
      const sameAsPrev =
        !!prev &&
        prev.user_id === msg.user_id &&
        !showStamp &&
        (receiptsByMsg.get(prev.id)?.length ?? 0) === 0;
      const sameAsNext =
        !!next && next.user_id === msg.user_id && gapNext < GAP_MS && receipts.length === 0;
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

  if (messages.length === 0) {
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
      onScroll={onScroll}
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
  // Web: px-4 py-4 on the scroller.
  content: { paddingHorizontal: 16, paddingVertical: 16 },
  // Web: m-auto max-w-xs text-center.
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  emptyTitle: { fontWeight: "600", textAlign: "center", maxWidth: 320 },
  emptyNote: { marginTop: 4, textAlign: "center", maxWidth: 320 },
});
