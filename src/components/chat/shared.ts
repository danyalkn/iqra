/**
 * Chat constants and pure helpers shared by the message list (chat.tsx,
 * MessageList, MessageRow, ActionOverlay, ReactorsSheet) and the composer
 * side (Composer, MentionSuggestions, MembersSheet, MessageBody). Ported
 * verbatim from the top of reference/web-pwa/app/(app)/chat/ChatClient.tsx.
 * No React, no react-native: anything either side needs to agree on lives
 * here so the two halves cannot drift.
 */
import type { GroupMember, Message } from "@/lib/types";

/** Show a centered time separator when a message lands >= 1h after the
 *  previous one (within the hour, consecutive messages share the last
 *  separator). */
export const GAP_MS = 60 * 60 * 1000;

/** IG's quick-reaction set, in IG's order (docs/DECISIONS.md § Chat). */
export const QUICK_EMOJI = ["❤️", "😂", "😮", "😢", "😡", "👍"] as const;

export const LONG_PRESS_MS = 420;
/** Drag a message this far to the right (points) to start a reply. */
export const SWIPE_REPLY_TRIGGER = 52;
/** Largest reply drag (points); the row rubber-bands past this. */
export const SWIPE_REPLY_MAX = 80;
/** Largest "reveal times" drag to the left (points). */
export const REVEAL_MAX = 64;
/** The list's right padding. Each row keeps its own receipt gutter inside
 *  it, and the revealed time box starts just past it, at the screen edge. */
export const LIST_PAD_RIGHT = 8;

/** "@all" mentions every member, so it notifies even people who muted chat. */
export const ALL_TOKEN = "all";
export const ALL_RE = /(?:^|\s)@all(?![\w])/;

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a Postgres timestamp defensively. Realtime payloads can serialize
 *  timestamptz WITHOUT an offset ("2026-09-03T05:40:47.287442") - Date.parse
 *  would read that as device-local time and shift it by hours, silently
 *  corrupting every frontier comparison. Bare timestamps here are always UTC. */
export function parseTs(s: string): number {
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
}

export function firstName(name: string | undefined | null): string {
  return (name ?? "Member").split(/\s+/)[0];
}

/** Optimistic rows carry a temp id until the server copy replaces them. */
export function isTemp(id: string): boolean {
  return id.startsWith("temp-");
}

/** A random id for optimistic rows (crypto.randomUUID is on Hermes via
 *  expo's polyfill, but a plain fallback keeps this file dependency-free). */
export function tempId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid =
    c?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `temp-${uuid}`;
}

/** Regex that finds @mentions of known members and @all in a body. Member
 *  names first so a name starting with "All" wins over @all. */
export function mentionRegex(names: string[]): RegExp {
  return new RegExp(
    `@(${[...names.map(escapeRe), `${ALL_TOKEN}(?![\\w])`].join("|")})`,
    "g",
  );
}

/** Who a sent body mentions: everyone except the sender for @all, otherwise
 *  the members whose exact display name appears after an @. */
export function mentionedUserIds(body: string, members: GroupMember[], userId: string): string[] {
  const mentionAll = ALL_RE.test(body);
  return members
    .filter((m) => m.user_id !== userId && (mentionAll || body.includes(`@${m.display_name}`)))
    .map((m) => m.user_id);
}

/** "You replied to Yusuf" caption for a reply message. */
export function replyCaption(
  msg: Message,
  original: Message | undefined,
  userId: string,
  nameOf: (id: string) => string | undefined,
): string {
  const replier = msg.user_id === userId ? "You" : firstName(nameOf(msg.user_id));
  if (!original) return `${replier} replied`;
  let target: string;
  if (original.user_id === userId) {
    target = msg.user_id === userId ? "yourself" : "you";
  } else if (original.user_id === msg.user_id) {
    target = msg.user_id === userId ? "yourself" : "themselves";
  } else {
    target = firstName(nameOf(original.user_id));
  }
  return `${replier} replied to ${target}`;
}

/** A row of the owner-only `search_users` RPC (add members from the
 *  members sheet). */
export type SearchUser = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  email: string;
  is_member: boolean;
};

/** The typeahead's view of the draft: the text after the active "@" and
 *  where that "@" sits in the draft. */
export type MentionQuery = { q: string; start: number };
