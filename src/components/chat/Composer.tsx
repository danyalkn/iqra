import { Send, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import type { GroupMember } from "@/lib/types";

import type { ComposerProps } from "./contracts";
import { MentionSuggestions } from "./MentionSuggestions";
import { ALL_TOKEN, firstName, isTemp, mentionedUserIds, type MentionQuery } from "./shared";

/** The web's useSwipeDownDismiss threshold: a 40px downward drag blurs the
 *  field. On native the same drag dismisses the keyboard. */
const SWIPE_DISMISS_PX = 40;

/** Text before the caret ends in "@" + a partial name (no spaces, no second
 *  "@"): the typeahead is open for that name. */
const MENTION_RE = /(?:^|\s)@([^\s@]*)$/;

function dismissKeyboard() {
  Keyboard.dismiss();
}

/**
 * The chat composer: reply bar, growing text field, send button and the
 * @mention typeahead above it. Ported from the draft / typeahead / send
 * block (around lines 1040-1170) and the composer markup (around lines
 * 1620-1722) of reference/web-pwa/app/(app)/chat/ChatClient.tsx.
 *
 * Deliberate differences from the web:
 * - Enter sent and Shift+Enter inserted a newline. A phone keyboard has no
 *   Shift, so return inserts a newline (submitBehavior "newline", RN 0.88's
 *   form of blurOnSubmit=false) and only the Send button sends.
 * - ArrowUp / ArrowDown cycled the typeahead's active row and Enter / Tab
 *   picked it. No arrows on a phone: the first row is always the active one
 *   and any row picks on tap.
 * - Escape cleared the reply / typeahead; native has the X button and
 *   typing past the "@" token.
 * - The caret: a textarea reports selectionStart with each change event. RN
 *   reports text (onChangeText) and caret (onSelectionChange) separately and
 *   the order differs by platform, so both handlers re-run the query with
 *   the latest pair and the second one wins.
 * Keyboard avoidance belongs to the screen; this is a plain View.
 */
export function Composer({
  groupName,
  members,
  userId,
  replyTo,
  onCancelReply,
  onSend,
  focusRequest,
  bottomPadding,
}: ComposerProps) {
  const c = useTheme();
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [draft, setDraft] = useState("");
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  // Controlled only for the render after a mention pick (the web's
  // caretToSet + setSelectionRange); released on the next caret or text event.
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  // Latest text and caret, readable from whichever event fires second.
  const draftRef = useRef("");
  const caretRef = useRef(0);
  // Caret to place after the draft commits with an inserted mention.
  const caretToSet = useRef<number | null>(null);

  // startReply bumps focusRequest after a swipe or a long-press Reply (web:
  // inputRef.current?.focus() in startReply). 0 at mount means do not focus.
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  // Restore the caret after inserting a mention (web: the [draft] effect
  // calling setSelectionRange). The controlled `selection` prop lands in the
  // same commit as the text; this imperative call after the commit backs it
  // up in case the native side applied the selection before the longer text.
  useEffect(() => {
    const pos = caretToSet.current;
    if (pos == null) return;
    caretToSet.current = null;
    inputRef.current?.focus();
    inputRef.current?.setSelection(pos, pos);
  }, [draft]);

  // null = the "@all" entry, listed first while the query could still be it.
  const suggestions = useMemo((): (GroupMember | null)[] => {
    if (!mentionQuery) return [];
    const q = mentionQuery.q.toLowerCase();
    const all = ALL_TOKEN.startsWith(q) || "everyone".startsWith(q) ? [null] : [];
    return [...all, ...members.filter((m) => m.display_name.toLowerCase().includes(q))].slice(
      0,
      5,
    );
  }, [mentionQuery, members]);

  /** The web's onDraftChange minus setDraft: find the open "@" token before
   *  the caret. Same query keeps the same object so no render is spent. */
  const syncQuery = (value: string, caret: number) => {
    const before = value.slice(0, Math.min(caret, value.length));
    const m = before.match(MENTION_RE);
    if (m) {
      const q = m[1];
      const start = before.length - q.length - 1;
      setMentionQuery((prev) => (prev && prev.q === q && prev.start === start ? prev : { q, start }));
    } else {
      setMentionQuery(null);
    }
  };

  const onChangeText = (value: string) => {
    draftRef.current = value;
    if (selection) setSelection(undefined);
    setDraft(value);
    // The caret may not have reported yet (clamped to the new length); the
    // selection event that follows re-runs this with the real caret.
    syncQuery(value, caretRef.current);
  };

  const onSelectionChange = (start: number) => {
    caretRef.current = start;
    if (selection) setSelection(undefined);
    syncQuery(draftRef.current, start);
  };

  const pickMention = (member: GroupMember | null) => {
    if (!mentionQuery) return;
    const current = draftRef.current;
    // Web: inputRef.current?.selectionStart ?? start + q.length + 1.
    const caret = Math.min(Math.max(caretRef.current, mentionQuery.start + 1), current.length);
    const before = current.slice(0, mentionQuery.start);
    const after = current.slice(caret);
    const insert = `@${member ? member.display_name : ALL_TOKEN} `;
    const next = before + insert + after;
    const pos = (before + insert).length;
    draftRef.current = next;
    caretRef.current = pos;
    caretToSet.current = pos;
    setDraft(next);
    setSelection({ start: pos, end: pos });
    setMentionQuery(null);
  };

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    const mentions = mentionedUserIds(body, members, userId);
    // A reply to a row that is still optimistic has no server id yet.
    const replyId = replyTo && !isTemp(replyTo.id) ? replyTo.id : null;
    draftRef.current = "";
    caretRef.current = 0;
    setDraft("");
    setSelection(undefined);
    setMentionQuery(null);
    if (replyTo) onCancelReply();
    onSend(body, mentions, replyId);
  };

  // Swipe down on the composer to dismiss the keyboard (web:
  // useSwipeDownDismiss spread on the same bar). The pan only activates after
  // a deliberate 40pt downward drag, so taps, press-ins on the typeahead and
  // the field's own touches are untouched.
  const swipeDown = usePanGesture({
    activeOffsetY: SWIPE_DISMISS_PX,
    onActivate: () => {
      "worklet";
      scheduleOnRN(dismissKeyboard);
    },
  });

  const canSend = draft.trim().length > 0;
  const replyName = replyTo
    ? replyTo.user_id === userId
      ? "yourself"
      : firstName(members.find((m) => m.user_id === replyTo.user_id)?.display_name)
    : null;

  return (
    <GestureDetector gesture={swipeDown}>
      <View
        style={[
          styles.root,
          {
            backgroundColor: c.surface,
            borderTopColor: c.border,
            paddingBottom: bottomPadding + 10,
          },
        ]}
      >
        {/* Mention typeahead: floats above the bar, over the list. */}
        {mentionQuery && suggestions.length > 0 && (
          <MentionSuggestions suggestions={suggestions} activeIdx={0} onPick={pickMention} />
        )}

        {/* Replying-to bar */}
        {replyTo && (
          <View
            style={[styles.replyBar, { backgroundColor: c.surface2, borderLeftColor: c.accent }]}
          >
            <View style={styles.grow}>
              <Text style={[Type.caption, styles.semibold, { color: c.accent }]}>
                Replying to {replyName}
              </Text>
              <Text numberOfLines={1} style={[Type.footnote, { color: c.muted }]}>
                {replyTo.body}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              hitSlop={6}
              onPress={onCancelReply}
              style={[styles.closeBtn, { backgroundColor: c.surface }]}
            >
              <X size={14} color={c.muted} />
            </Pressable>
          </View>
        )}

        <View style={styles.fieldRow}>
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={onChangeText}
            onSelectionChange={(e) => onSelectionChange(e.nativeEvent.selection.start)}
            selection={selection}
            multiline
            submitBehavior="newline"
            placeholder={`Message ${groupName}…`}
            placeholderTextColor={c.faint}
            selectionColor={c.accent}
            textAlignVertical="top"
            accessibilityLabel="Message"
            // Fabric measures multiline content, so the field grows with the
            // text on both platforms and scrolls inside once it hits maxHeight
            // (web: rows=1 + max-h-32).
            style={[styles.field, Type.callout, { color: c.foreground, backgroundColor: c.surface2 }]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={({ pressed }) => [
              styles.sendBtn,
              Elevation.e2,
              { backgroundColor: c.accent },
              !canSend && styles.sendDisabled,
              pressed && canSend && styles.sendPressed,
            ]}
          >
            <Send size={18} strokeWidth={2.25} color={c.onAccent} />
          </Pressable>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    // The typeahead hangs outside this box; keep it above the list sibling.
    zIndex: 1,
  },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderRadius: Radius.md,
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 8,
  },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  field: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 128,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.4 },
  sendPressed: { transform: [{ scale: 0.95 }] },
});
