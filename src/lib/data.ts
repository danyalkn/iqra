import type { SupabaseClient } from "@supabase/supabase-js";

import { NUDGE_COOLDOWN_MS } from "@/lib/nudges";
import type {
  ChatRead,
  DayReminder,
  LogRow,
  Membership,
  Reminder,
  GroupMember,
  Message,
  Reaction,
  ReadingRow,
} from "@/lib/types";

/**
 * Read queries, ported from reference/web-pwa/data.ts. The web version ran
 * these in Next server components with a per-request client; here every
 * function takes the shared client (src/supabase/client.ts) as its first
 * argument so this file stays free of react-native imports and the queries
 * stay byte-for-byte comparable with the web repo.
 */
type Client = SupabaseClient;

/**
 * Fetch every row of a query, a page at a time. PostgREST silently caps each
 * response at the project's "Max rows" setting (1000 by default), so a plain
 * `.limit(5000)` quietly returns only the newest 1000. Pages are requested by
 * offset with an exact count, so this works whatever the cap is. `max` is a
 * safety valve. The query must have a total order (add a tiebreak column).
 */
async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; count: number | null }>,
  max: number,
): Promise<T[]> {
  const out: T[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (out.length < Math.min(total, max)) {
    const from = out.length;
    const { data, count } = await page(from, Math.min(from + 999, max - 1));
    if (count != null) total = count;
    const rows = (data as T[] | null) ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
  }
  return out;
}

/** All reactions on the group's recent messages (small group - fetch all). */
export async function getGroupReactions(
  supabase: Client,
  groupId: string,
  limit = 1000,
): Promise<Reaction[]> {
  const { data } = await supabase
    .from("message_reactions")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data as Reaction[] | null) ?? [];
}

/** Every member's chat read frontier for the circle (read receipts). */
export async function getGroupChatReads(
  supabase: Client,
  groupId: string,
): Promise<ChatRead[]> {
  const { data } = await supabase
    .from("chat_reads")
    .select("user_id, last_read_at")
    .eq("group_id", groupId);
  return (data as ChatRead[] | null) ?? [];
}

/** All-time page-bearing entries for the group khatmah - EVERY type counts
 *  (sabak, sabak para, dhor, reading, revising), summed as Uthmani pages. */
export async function getGroupPagesAllTime(
  supabase: Client,
  groupId: string,
): Promise<ReadingRow[]> {
  // Newest first: the cap is a safety valve, and if it ever bites it must
  // shave the oldest rows (a slight all-time undercount) rather than the
  // newest - the month-scoped stats and leaderboard read from these rows and
  // would otherwise silently read zero.
  return fetchAll<ReadingRow>(
    (from, to) =>
      supabase
        .from("log_entries")
        .select("user_id, logged_at, pages_equiv", { count: "exact" })
        .eq("group_id", groupId)
        .order("logged_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    10000,
  );
}

/** The current user's first group membership (the app assumes one circle). */
export async function getMyMembership(
  supabase: Client,
): Promise<Membership | null> {
  const { data } = await supabase
    .from("group_members")
    .select("group_id, role, groups(name)")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const group = data.groups as unknown as { name: string } | null;
  return {
    group_id: data.group_id as string,
    group_name: group?.name ?? "Your circle",
    role: (data.role as string) ?? "member",
  };
}

/** The signed-in user's own entries since `sinceDays` ago (for Today + streak). */
export async function getMyRecentEntries(
  supabase: Client,
  groupId: string,
  userId: string,
  sinceDays = 120,
): Promise<LogRow[]> {
  const since = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false });

  return (data as LogRow[] | null) ?? [];
}

/** Every entry the signed-in user has ever logged in the group, newest
 *  first (Journal + personal progress). One person's history is small; the
 *  cap is only a safety valve. */
export async function getMyEntriesAllTime(
  supabase: Client,
  groupId: string,
  userId: string,
  limit = 5000,
): Promise<LogRow[]> {
  return fetchAll<LogRow>(
    (from, to) =>
      supabase
        .from("log_entries")
        .select("*", { count: "exact" })
        .eq("group_id", groupId)
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    limit,
  );
}

/** Everyone in the group, with their profile name/avatar (for chat + feed).
 *  Two queries on purpose: there is no direct FK group_members.user_id ->
 *  profiles.id (both reference auth.users), so a PostgREST embed can't resolve
 *  it. We fetch the member ids, then their profiles. */
export async function getGroupMembers(
  supabase: Client,
  groupId: string,
): Promise<GroupMember[]> {
  const { data: rows } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  const ids = ((rows as { user_id: string }[] | null) ?? []).map(
    (r) => r.user_id,
  );
  if (ids.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  const byId = new Map(
    (
      (profiles as
        | {
            id: string;
            display_name: string | null;
            avatar_url: string | null;
          }[]
        | null) ?? []
    ).map((p) => [p.id, p]),
  );

  return ids.map((id) => ({
    user_id: id,
    display_name: byId.get(id)?.display_name ?? "Member",
    avatar_url: byId.get(id)?.avatar_url ?? null,
  }));
}

/** Recent messages for the group, oldest to newest (for the chat view). */
export async function getGroupMessages(
  supabase: Client,
  groupId: string,
  limit = 100,
): Promise<Message[]> {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data as Message[] | null) ?? [];
  return rows.reverse();
}

/** All entries in the group (every member) for the feed. */
export async function getGroupEntries(
  supabase: Client,
  groupId: string,
  sinceDays = 30,
): Promise<LogRow[]> {
  const since = new Date(
    Date.now() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false })
    .limit(1000);
  return (data as LogRow[] | null) ?? [];
}

/** When the user last nudged each recipient, for nudges still inside the
 *  cooldown (NUDGE_COOLDOWN_MS), plus the time it was read at. Those
 *  recipients' Nudge buttons start disabled and re-enable when it runs out. */
export async function getMyRecentNudges(
  supabase: Client,
  userId: string,
): Promise<{ asOf: number; lastAt: Record<string, string> }> {
  const asOf = Date.now();
  const since = new Date(asOf - NUDGE_COOLDOWN_MS).toISOString();
  const { data } = await supabase
    .from("nudges")
    .select("to_user, created_at")
    .eq("from_user", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  const lastAt: Record<string, string> = {};
  for (const r of (data as { to_user: string; created_at: string }[] | null) ??
    []) {
    lastAt[r.to_user] = r.created_at;
  }
  return { asOf, lastAt };
}

/** The current user's reminders, earliest first. */
export async function getMyReminders(
  supabase: Client,
  userId: string,
): Promise<Reminder[]> {
  const { data } = await supabase
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .order("time", { ascending: true });
  return (data as Reminder[] | null) ?? [];
}

/** The current user's one-time reminders between two profile-local dates
 *  (inclusive; Today asks for today..tomorrow), soonest first. */
export async function getMyDayReminders(
  supabase: Client,
  userId: string,
  fromYmd: string,
  toYmd: string,
): Promise<DayReminder[]> {
  const { data } = await supabase
    .from("day_reminders")
    .select("*")
    .eq("user_id", userId)
    .gte("remind_on", fromYmd)
    .lte("remind_on", toYmd)
    .order("remind_on", { ascending: true })
    .order("time", { ascending: true });
  return (data as DayReminder[] | null) ?? [];
}
