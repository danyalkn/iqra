/**
 * Prop contracts between the two halves of the Chat port.
 *
 *   List side (src/app/(tabs)/chat.tsx, MessageList, MessageRow,
 *   ReactionChips, ActionOverlay, ReactorsSheet, useChatSync): owns the
 *   messages / reactions / reads state, realtime, optimistic sends, the
 *   keyboard-avoiding screen layout and the header.
 *
 *   Composer side (Composer, MentionSuggestions, MembersSheet, MessageBody):
 *   owns the draft, the @mention typeahead, the reply bar, the members sheet
 *   (mute toggle, owner-only add member) and mention highlighting.
 *
 * Both halves import these types; neither edits this file without the other.
 */
import type { StyleProp, TextStyle } from "react-native";

import type { PickedImage } from "@/data/chatImages";
import type { GroupMember, Message } from "@/lib/types";

/** A message as the chat holds it: the row, plus the sender's own copy of
 *  a picture while the row is optimistic and until the next sync replaces
 *  it. Native only, which is why it is not on the shared Message type. */
export type ChatMessage = Message & { local_image?: string };

/** The composer at the bottom of the chat screen: reply bar, textarea,
 *  send button and the mention typeahead floating above it. The screen
 *  owns keyboard avoidance; the composer is a plain View that reports its
 *  send. */
export type ComposerProps = {
  groupName: string;
  members: GroupMember[];
  userId: string;
  /** The message being replied to, shown in the bar above the field. */
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  /**
   * Called with the trimmed body (empty for a picture alone), the mentioned
   * user ids (from mentionedUserIds in shared.ts), the reply target id (null
   * when the reply target is still an optimistic temp row) and the picture,
   * already resized on the phone (src/data/chatImages.ts), or null. The list
   * side uploads it, inserts the optimistic row and the server row; the
   * composer has already cleared the draft, the picture, the reply and the
   * typeahead by the time this fires.
   */
  onSend: (
    body: string,
    mentions: string[],
    replyId: string | null,
    image: PickedImage | null,
  ) => void;
  /** Increment to focus the field (startReply does this after a swipe or a
   *  long-press Reply). 0 at mount means "do not focus". */
  focusRequest: number;
  /** Bottom padding under the field row: the screen passes the tab bar /
   *  home-indicator clearance while the keyboard is closed and a small gap
   *  while it is open. */
  bottomPadding: number;
};

/** The sheet behind the header: group name, member count, the personal
 *  "Message notifications" toggle (profiles.notify_chat), the owner-only
 *  "Add member" search (search_users / add_group_member RPCs) and the
 *  member list. Owns its own notify state (reads profile.notify_chat from
 *  useSession, writes the column, refreshes the profile). */
export type MembersSheetProps = {
  open: boolean;
  onClose: () => void;
  groupId: string;
  groupName: string;
  userId: string;
  isOwner: boolean;
  members: GroupMember[];
  /** Adding a member appends to the list the whole screen uses. */
  onMembersChange: (update: (prev: GroupMember[]) => GroupMember[]) => void;
};

/** A message body with @mentions of known members (and @all) highlighted.
 *  Renders a single <Text>; the caller passes the bubble's text style. */
export type MessageBodyProps = {
  body: string;
  /** Every member's display name (memberNames in the screen). */
  names: string[];
  /** Mine = accent bubble, so mentions underline instead of tinting. */
  mine: boolean;
  style?: StyleProp<TextStyle>;
};
