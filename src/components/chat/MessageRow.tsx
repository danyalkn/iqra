import * as Clipboard from "expo-clipboard";
import { Reply } from "lucide-react-native";
import { useRef, type ComponentRef } from "react";
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Avatar } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { GroupMember, Message, Reaction } from "@/lib/types";

import type { Anchor } from "./ActionOverlay";
import { MessageBody } from "./MessageBody";
import { ReactionChips } from "./ReactionChips";
import { LONG_PRESS_MS, REVEAL_MAX, SWIPE_REPLY_MAX, SWIPE_REPLY_TRIGGER } from "./shared";

/** Everything the list derives for one message (the per-row locals of the
 *  web's messages.map), computed once in MessageList so a recycled row only
 *  reads. */
export type RowMeta = {
  mine: boolean;
  sender: GroupMember | undefined;
  /** chatStamp label when this message opens a new time block, else null. */
  stamp: string | null;
  sameAsPrev: boolean;
  sameAsNext: boolean;
  firstOfGroup: boolean;
  lastOfGroup: boolean;
  /** Optimistic row not yet on the server. */
  pending: boolean;
  reactions: Reaction[];
  /** Members whose read frontier stops at this message. */
  receipts: GroupMember[];
  /** The message this one replies to, when loaded. */
  original: Message | undefined;
  /** "You replied to Yusuf", only for replies. */
  caption: string | null;
  /** timeLabel, or "…" while pending. */
  time: string;
  /** Briefly highlighted after a jump from a reply quote. */
  flash: boolean;
};

export type MessageRowProps = {
  msg: Message;
  meta: RowMeta;
  memberNames: string[];
  /** List-level "reveal times" offset: a left drag on ANY row translates
   *  every row (the web translated the whole column so all times show). */
  revealX: SharedValue<number>;
  /** Tap on the bubble; the list turns two within 300 ms into a ❤️. */
  onPress: (mid: string) => void;
  onLongPress: (mid: string, anchor: Anchor) => void;
  onSwipeReply: (mid: string) => void;
  onOpenReactors: (mid: string) => void;
  /** Tap on the quoted original: scroll to it. */
  onQuotePress: (mid: string) => void;
};

/** Screen-reader stand-ins for the long press, swipe and Copy menu. */
const A11Y_ACTIONS = [
  { name: "react", label: "React" },
  { name: "reply", label: "Reply" },
  { name: "copy", label: "Copy" },
];

/** "#rrggbb" at an alpha, for the web's border-accent/50 and bg-surface-2/70. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * One message: time stamp, reply context, the bubble line (avatar, bubble,
 * revealed time) and the read-receipt row. Ported from the messages.map in
 * reference/web-pwa/app/(app)/chat/ChatClient.tsx.
 *
 * Gestures, where native differs from the web's touch handlers:
 * - A pan on the row replaces the list-level touchstart/move/end: dragging
 *   right on a non-temp message pulls the row out (reply at
 *   SWIPE_REPLY_TRIGGER), dragging left moves every row via `revealX`.
 *   activeOffsetX / failOffsetY leave vertical scrolling to the list.
 * - The bubble is a Pressable: onLongPress (LONG_PRESS_MS) replaces the
 *   web's touchstart timer and onPress carries the double-tap check. The
 *   pan activating cancels the press, as touchmove cancelled the timer.
 * - Screen readers get the same actions as accessibility actions on the
 *   bubble (React opens the overlay, Reply, Copy), since a VoiceOver or
 *   TalkBack activation is one press and swipes belong to the reader.
 */
export function MessageRow({
  msg,
  meta,
  memberNames,
  revealX,
  onPress,
  onLongPress,
  onSwipeReply,
  onOpenReactors,
  onQuotePress,
}: MessageRowProps) {
  const c = useTheme();
  const {
    mine,
    sender,
    stamp,
    sameAsPrev,
    sameAsNext,
    firstOfGroup,
    lastOfGroup,
    pending,
    reactions,
    receipts,
    original,
    caption,
    time,
    flash,
  } = meta;
  const mid = msg.id;
  const bubbleRef = useRef<ComponentRef<typeof View>>(null);

  // Swipe-right-to-reply offset for this row only (the web's swipeReply.x).
  const dragX = useSharedValue(0);

  const pan = usePanGesture({
    activeOffsetX: [-16, 16],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      "worklet";
      const dx = e.translationX;
      if (dx < 0) {
        // reveal times
        dragX.set(0);
        revealX.set(Math.max(-REVEAL_MAX, dx));
      } else if (!pending) {
        // drag a message right to reply
        revealX.set(0);
        dragX.set(Math.min(dx, SWIPE_REPLY_MAX));
      }
    },
    onDeactivate: (e) => {
      "worklet";
      // A cancelled drag (system interruption, another recognizer taking the
      // touch) only springs back; it never replies.
      if (!e.canceled && dragX.get() >= SWIPE_REPLY_TRIGGER) scheduleOnRN(onSwipeReply, mid);
      // Web: transform 220ms var(--ease-spring) back to rest.
      dragX.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }));
      revealX.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }));
    },
  });

  const revealStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: revealX.get() }],
  }));
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.get() }],
  }));
  const affordanceStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, dragX.get() / SWIPE_REPLY_TRIGGER),
  }));

  const handlePress = () => onPress(mid);
  const handleLongPress = () => {
    if (pending) return;
    // Window coordinates: the overlay is a Modal positioned in the same space.
    const measure = () =>
      bubbleRef.current?.measureInWindow((x, y, w, h) =>
        onLongPress(mid, { top: y, bottom: y + h, left: x, right: x + w }),
      );
    if (!Keyboard.isVisible()) {
      measure();
      return;
    }
    // The overlay drops the keyboard, and the list grows back under it, so a
    // bubble measured now would sit a keyboard height away from where it
    // ends up. Dismiss first and measure once the keyboard is gone (a frame
    // later, after the avoiding view's last layout); the timer covers a hide
    // event that never comes.
    let done = false;
    const afterHide = () => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(fallback);
      requestAnimationFrame(measure);
    };
    const sub = Keyboard.addListener("keyboardDidHide", afterHide);
    const fallback = setTimeout(afterHide, 600);
    Keyboard.dismiss();
  };
  const handleA11yAction = (e: AccessibilityActionEvent) => {
    if (pending) return;
    switch (e.nativeEvent.actionName) {
      case "react":
        handleLongPress();
        break;
      case "reply":
        onSwipeReply(mid);
        break;
      case "copy":
        void Clipboard.setStringAsync(msg.body).catch(() => {});
        break;
    }
  };
  const handleQuote = () => {
    if (original) onQuotePress(original.id);
  };
  const handleChips = () => onOpenReactors(mid);

  const bodyColor = mine ? c.onAccent : c.foreground;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.row,
          // Web: mt-0.5 within a group, mt-3 between groups; mb-3 leaves
          // room for the chip hanging under the bubble.
          { marginTop: sameAsPrev ? 2 : 12, marginBottom: reactions.length > 0 ? 12 : 0 },
          flash && { backgroundColor: c.accentTint },
          revealStyle,
        ]}
      >
        {stamp !== null && (
          <View style={styles.stampWrap}>
            <Text style={[styles.stamp, { color: c.faint }]}>{stamp}</Text>
          </View>
        )}

        {/* Reply context - IG puts the caption + quoted bubble above */}
        {msg.reply_to && (
          <View style={[styles.replyCtx, mine ? styles.replyCtxMine : styles.replyCtxTheirs]}>
            <View style={styles.captionRow}>
              <Reply size={12} color={c.faint} />
              <Text style={[Type.caption, { color: c.faint }]}>{caption}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to the original message"
              onPress={handleQuote}
              disabled={!original}
              style={[
                styles.quote,
                mine ? styles.quoteMine : styles.quoteTheirs,
                {
                  borderLeftColor: withAlpha(c.accent, 0.5),
                  backgroundColor: withAlpha(c.surface2, 0.7),
                },
              ]}
            >
              <Text numberOfLines={2} style={[Type.footnote, { color: c.muted }]}>
                {original ? original.body : "Original message unavailable"}
              </Text>
            </Pressable>
          </View>
        )}

        <Animated.View style={dragStyle}>
          <View style={[styles.line, mine ? styles.lineMine : styles.lineTheirs]}>
            {/* Swipe-right reply affordance */}
            <Animated.View
              pointerEvents="none"
              style={[styles.affordance, { backgroundColor: c.surface2 }, affordanceStyle]}
            >
              <Reply size={16} color={c.muted} />
            </Animated.View>

            {!mine && (
              <View style={styles.avatarColumn}>
                {lastOfGroup && (
                  <Avatar name={sender?.display_name ?? "Member"} src={sender?.avatar_url} size={28} />
                )}
              </View>
            )}

            <Pressable
              ref={bubbleRef}
              onPress={handlePress}
              onLongPress={pending ? undefined : handleLongPress}
              delayLongPress={LONG_PRESS_MS}
              accessibilityActions={pending ? undefined : A11Y_ACTIONS}
              onAccessibilityAction={handleA11yAction}
              style={[
                styles.bubble,
                { backgroundColor: mine ? c.accent : c.surface2 },
                // Tighten the "spine" corners so a group reads as one stack.
                mine && sameAsPrev && styles.spineTopRight,
                mine && sameAsNext && styles.spineBottomRight,
                !mine && sameAsPrev && styles.spineTopLeft,
                !mine && sameAsNext && styles.spineBottomLeft,
                pending && styles.pending,
              ]}
            >
              {!mine && firstOfGroup && (
                <Text style={[Type.footnote, styles.sender, { color: c.accent }]}>
                  {sender?.display_name ?? "Member"}
                </Text>
              )}
              <MessageBody
                body={msg.body}
                names={memberNames}
                mine={mine}
                style={[styles.body, { color: bodyColor }]}
              />
              <ReactionChips reactions={reactions} mine={mine} onOpen={handleChips} />
            </Pressable>

            {/* Time revealed by swiping the conversation left. */}
            <View pointerEvents="none" style={styles.timeWrap}>
              <Text numberOfLines={1} style={[styles.time, { color: c.faint }]}>
                {time}
              </Text>
            </View>
          </View>

          {/* IG-style read receipts: tiny avatars of everyone whose read
              frontier stops at this message, right-aligned. */}
          {receipts.length > 0 && (
            <View style={[styles.receipts, { marginTop: reactions.length > 0 ? 16 : 4 }]}>
              {receipts.map((m, i) => (
                <View
                  key={m.user_id}
                  // ring-2 ring-canvas: a 2px canvas ring around each avatar,
                  // drawn as padding so the 18px image is not shrunk by a border.
                  style={[styles.ring, { backgroundColor: c.canvas }, i > 0 && styles.overlap]}
                >
                  <Avatar name={m.display_name} src={m.avatar_url} size={18} />
                </View>
              ))}
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: Radius.lg },
  stampWrap: { alignItems: "center", paddingTop: 4, paddingBottom: 8 },
  stamp: { fontSize: 11, lineHeight: 14, fontWeight: "500" },
  replyCtx: { paddingTop: 4 },
  replyCtxMine: { alignItems: "flex-end", paddingRight: 4 },
  // pl-9: clears the 28px avatar column plus its gap.
  replyCtxTheirs: { alignItems: "flex-start", paddingLeft: 36 },
  captionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  quote: {
    maxWidth: "70%",
    borderRadius: Radius.lg,
    borderLeftWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 6,
    // -mb-1: the quote tucks behind the bubble's top edge.
    marginBottom: -4,
  },
  quoteMine: { marginRight: 4 },
  quoteTheirs: { marginLeft: 4 },
  line: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  lineMine: { justifyContent: "flex-end" },
  lineTheirs: { justifyContent: "flex-start" },
  affordance: {
    position: "absolute",
    left: -36,
    top: "50%",
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarColumn: { width: 28 },
  bubble: {
    maxWidth: "76%",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  spineTopRight: { borderTopRightRadius: 7 },
  spineBottomRight: { borderBottomRightRadius: 7 },
  spineTopLeft: { borderTopLeftRadius: 7 },
  spineBottomLeft: { borderBottomLeftRadius: 7 },
  pending: { opacity: 0.7 },
  sender: { fontWeight: "600", marginBottom: 2 },
  // Web: text-[15px] leading-snug.
  body: { fontSize: 15, lineHeight: 20 },
  // Web: absolute left-[calc(100%+1rem)] w-16 pr-3 text-right, centered on
  // the line; a full-height box centers without a percentage transform.
  timeWrap: {
    position: "absolute",
    left: "100%",
    top: 0,
    bottom: 0,
    marginLeft: 16,
    width: 64,
    paddingRight: 12,
    justifyContent: "center",
  },
  time: { fontSize: 11, lineHeight: 14, textAlign: "right", fontVariant: ["tabular-nums"] },
  receipts: { flexDirection: "row", justifyContent: "flex-end", paddingRight: 4 },
  ring: { width: 22, height: 22, borderRadius: 11, padding: 2 },
  overlap: { marginLeft: -6 },
});
