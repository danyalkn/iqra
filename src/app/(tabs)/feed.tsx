import * as Haptics from "expo-haptics";
import { useFocusEffect } from "expo-router";
import { Inbox, Users, WifiOff } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { FeedCardView } from "@/components/feed/FeedCard";
import { LoggedTodayStrip } from "@/components/feed/LoggedTodayStrip";
import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { deleteEntry, markEntriesChanged } from "@/data/entryWrites";
import { useMembership } from "@/hooks/use-membership";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { getMyRecentNudges } from "@/lib/data";
import { dayLabel, lastNDaysEndingOn, localDate } from "@/lib/dates";
import { groupFeed } from "@/lib/feedGroups";
import { NUDGE_COOLDOWN_MS } from "@/lib/nudges";
import type { GroupMember, LogRow } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

/** Web: pb-6 under the list. Fixed 40 here: see the insets note on the
 *  screen (the tab bar is already cleared by the platform). */
const LIST_BOTTOM_CLEARANCE = 40;

const REFRESH_ERROR = "Couldn’t refresh the feed. Pull down to try again.";

/** First load of members + entries: not started, landed, or failed before
 *  ever landing. Once "ready" it stays ready; later refreshes that fail keep
 *  the list and show a banner instead (same shape as Today). */
type LoadState = "loading" | "ready" | "failed";

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The circle's entries, newest first, last 30 x 24 h, capped at 1000. Same
 *  select, filter, order and limit as getGroupEntries in src/lib/data.ts, but
 *  the error is kept: that helper (verbatim with the web) collapses a failed
 *  request into [], which here would read as "No activity yet" on a dead
 *  network. The web could live with that because its server re-ran the
 *  query on every visit. */
async function fetchGroupEntries(
  groupId: string,
  sinceDays = 30,
): Promise<{ rows: LogRow[] | null; error: boolean }> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false })
    .limit(1000);
  if (error) return { rows: null, error: true };
  return { rows: (data as LogRow[] | null) ?? [], error: false };
}

/** The circle's members with their profile name and avatar. Same two queries
 *  as getGroupMembers in src/lib/data.ts, but errors are kept: that helper
 *  swallows a failed profiles request into "Member" with no avatar, which here
 *  would draw a ready list of anonymous members on a flaky network. A member
 *  whose profile row is simply missing still falls back to "Member", as there. */
async function fetchMembers(
  groupId: string,
): Promise<{ members: GroupMember[] | null; error: boolean }> {
  const { data: rows, error: rowsError } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  if (rowsError) return { members: null, error: true };
  const ids = ((rows as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
  // The signed-in member is always in their own circle, so an empty list can
  // only mean the read was cut short; treat it as a failure.
  if (ids.length === 0) return { members: null, error: true };

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  if (profilesError) return { members: null, error: true };
  const byId = new Map(
    (
      (profiles as
        | { id: string; display_name: string | null; avatar_url: string | null }[]
        | null) ?? []
    ).map((p) => [p.id, p]),
  );
  return {
    members: ids.map((id) => ({
      user_id: id,
      display_name: byId.get(id)?.display_name ?? "Member",
      avatar_url: byId.get(id)?.avatar_url ?? null,
    })),
    error: false,
  };
}

/** Realtime delivers timestamptz columns WITHOUT an offset
 *  ("2026-09-03T05:40:47.287442"); Date would read that as local time and
 *  file the row under the wrong day or hour until the next refetch. Bare
 *  timestamps from Supabase are always UTC (ported from the web
 *  ChatClient's parser; the web FeedClient did not guard this). */
function utcIso(s: string): string {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z";
}

const byNewest = (a: LogRow, b: LogRow) =>
  a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0;

/**
 * Feed (reference/web-pwa/app/(app)/feed/page.tsx + FeedClient.tsx).
 *
 * The web page fetched members, the circle's entries and my recent nudges
 * on the server and handed them to the client as props. Native loads them
 * here once membership resolves, so every "initial" value the web took for
 * granted is async state below.
 *
 * Insets: on iOS react-native-screens flips the tab screen's first scroll
 * view to automatic content-inset adjustment (status bar at the top, the
 * tab bar and home indicator at the bottom), so the content pads 0 at the
 * top there; on Android native tabs apply only the bottom inset, so the top
 * is ours to pad. Same reasoning as Profile.
 */
export default function FeedScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile } = useSession();
  const { membership, refresh: refreshMembership } = useMembership();

  const userId = user?.id ?? null;
  const tz = profile?.timezone || deviceTimeZone();
  // undefined while loading, null when not in a circle yet.
  const groupId = membership?.group_id ?? null;
  const groupName = membership?.group_name ?? "";

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [entries, setEntries] = useState<LogRow[]>([]);
  // to_user -> ms timestamp of my last nudge to them.
  const [nudgedAt, setNudgedAt] = useState<Map<string, number>>(() => new Map());
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Clock floor for the nudge countdown: the web's `renderedAt` on load and
  // its `setNow(at)` on tap (see the cooldown block below).
  const [pressedAt, setPressedAt] = useState(0);

  // The current load state for callbacks that must not re-run when it
  // changes (a focus effect keyed on loadState would retry in a loop).
  const loadStateRef = useRef<LoadState>("loading");
  useEffect(() => {
    loadStateRef.current = loadState;
  }, [loadState]);
  // Whether this tab is the one on screen: the foreground-return refetch
  // only makes sense for the visible tab (the next focus refetches anyway).
  const focusedRef = useRef(false);
  // Only the newest request may land: a reload started later (refresh,
  // focus, foreground return) supersedes one still in flight.
  const loadSeq = useRef(0);
  // Local changes a refetch snapshot may not know about yet. A load that was
  // already in flight when the user deleted a row, or when a teammate's insert
  // arrived, would otherwise put the row back or drop the new one (the web
  // never refetched, so it had no such race).
  // Ids deleted this session (added when the delete starts, dropped again if
  // it fails): filtered out of every load result.
  const deletedIds = useRef<Set<string>>(new Set());
  // Rows delivered by realtime this session, with their arrival time: a load
  // that started before a row arrived may not contain it, so it is kept.
  const liveRows = useRef<Map<string, { row: LogRow; at: number }>>(new Map());

  // Whether a null membership is real ("not in a circle"). useMembership no
  // longer caches a failed read (getMyMembership throws and the hook keeps
  // `undefined` + `failed`), so null is already a confirmed answer; this
  // second read, with the error kept, is belt and braces for a member the
  // owner adds while the tab sits on the placeholder. "checking" until the
  // answer lands.
  const [circleCheck, setCircleCheck] = useState<"checking" | "none" | "error">("checking");
  const verifyCircle = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .limit(1);
    if (error) {
      setCircleCheck("error");
      return;
    }
    if (data && data.length > 0) {
      // A real member: the cached null was wrong. Re-read it; if that still
      // comes back null, stay on the error state with Try again.
      const m = await refreshMembership();
      setCircleCheck(m ? "checking" : "error");
      return;
    }
    setCircleCheck("none");
  }, [userId, refreshMembership]);

  // What the web page did on the server, once the circle is known. Also the
  // retry for every surface below (focus, pull-to-refresh, foreground
  // return), so a failed first fetch does not stick for the session.
  const load = useCallback((): Promise<void> => {
    if (!groupId || !userId) return Promise.resolve();
    const seq = ++loadSeq.current;
    const startedAt = Date.now();
    return Promise.all([
      fetchMembers(groupId),
      fetchGroupEntries(groupId),
      getMyRecentNudges(supabase, userId),
    ]).then(([memRes, ent, nudges]) => {
      if (seq !== loadSeq.current) return;
      // Any failed read is a failed load, not a half-drawn feed.
      if (ent.error || !ent.rows || memRes.error || !memRes.members) {
        if (loadStateRef.current === "ready") {
          setRefreshError(REFRESH_ERROR);
        } else {
          setLoadState("failed");
        }
        return;
      }
      const mem = memRes.members;
      // Merge, don't replace: drop rows deleted locally, and keep realtime
      // rows that arrived after this fetch began (the snapshot may predate
      // them). Rows that arrived earlier are in the snapshot already.
      const deleted = deletedIds.current;
      const rows = ent.rows.filter((e) => !deleted.has(e.id));
      const have = new Set(rows.map((e) => e.id));
      const extra: LogRow[] = [];
      for (const [id, { row, at }] of liveRows.current) {
        if (at < startedAt) liveRows.current.delete(id);
        else if (!have.has(id) && !deleted.has(id)) extra.push(row);
      }
      setMembers(mem);
      setEntries(extra.length > 0 ? [...extra, ...rows].sort(byNewest) : rows);
      // Seed the cooldown map from the server (nudges still inside the
      // window). A refetch keeps the newer of the two stamps so a nudge sent
      // a moment ago is never shortened by an older server row.
      setNudgedAt((prev) => {
        const next = new Map(prev);
        for (const [u, iso] of Object.entries(nudges.lastAt)) {
          const at = Date.parse(iso);
          if (Number.isFinite(at) && at > (next.get(u) ?? 0)) next.set(u, at);
        }
        return next;
      });
      // The web's `renderedAt`: the clock the cooldowns were read against,
      // so the first countdown frame is not read off a minute-old tick.
      if (Object.keys(nudges.lastAt).length > 0) {
        setPressedAt((p) => Math.max(p, nudges.asOf));
      }
      setRefreshError(null);
      setLoadState("ready");
    });
  }, [groupId, userId]);

  // First load, as soon as membership resolves (the tab may not be focused
  // yet: NativeTabs keeps every tab mounted).
  useEffect(() => {
    void load();
  }, [load]);

  // What the web could not do: Today and the Journal change entries while
  // this tab stays mounted, and postgres_changes has no replay, so every
  // focus re-reads the list. The first fetch still in flight is left alone.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      if (membership === null) void verifyCircle();
      else if (loadStateRef.current !== "loading") void load();
      return () => {
        focusedRef.current = false;
      };
    }, [load, membership, verifyCircle]),
  );

  // The OS may have killed the realtime socket while the app was away, and
  // inserts that happened meanwhile are never replayed: resync on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (focusedRef.current || loadStateRef.current === "failed") void load();
    });
    return () => sub.remove();
  }, [load]);

  // Retry for every surface: re-check the circle if that is what failed.
  const reload = useCallback(
    () => (membership === null ? verifyCircle() : load()),
    [membership, verifyCircle, load],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  // Live-update the feed when anyone logs (in-app only - no push for feed,
  // per DECISIONS "Notifications"). Ported 1:1 from the web; the focus and
  // foreground refetches above cover what a dropped socket misses.
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`feed-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "log_entries",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const raw = payload.new as LogRow;
          const row: LogRow = { ...raw, logged_at: utcIso(raw.logged_at) };
          liveRows.current.set(row.id, { row, at: Date.now() });
          setEntries((prev) =>
            prev.some((e) => e.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);

  // Nudge cooldowns. The web kept its own `now` state and ticked it once a
  // second while any button was cooling down. Here useNow owns the clock:
  // it ticks every second while a cooldown runs and on the minute otherwise
  // (the interval is state, adjusted during render from the map and the
  // last tick, the React-sanctioned way to derive it without an effect).
  // `pressedAt` is the web's `setNow(at)` on tap: without it the first
  // countdown frame would read off a tick up to a minute old.
  const [fast, setFast] = useState(false);
  const tick = useNow(fast ? 1000 : 60_000);
  const now = Math.max(tick, pressedAt);
  const cooldownLeft = (toUser: string) =>
    Math.max(0, (nudgedAt.get(toUser) ?? 0) + NUDGE_COOLDOWN_MS - now);
  const anyCoolingDown = [...nudgedAt.values()].some((at) => at + NUDGE_COOLDOWN_MS > now);
  if (fast !== anyCoolingDown) setFast(anyCoolingDown);

  const nudge = async (toUser: string) => {
    if (!groupId || !userId) return;
    const at = Date.now();
    setPressedAt(at);
    setNudgedAt((prev) => new Map(prev).set(toUser, at));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const { error } = await supabase.from("nudges").insert({
      group_id: groupId,
      from_user: userId,
      to_user: toUser,
      kind: "log_reminder",
    });
    if (error) {
      // Re-enable the button, unless a later nudge already replaced this one.
      setNudgedAt((prev) => {
        if (prev.get(toUser) !== at) return prev;
        const n = new Map(prev);
        n.delete(toUser);
        return n;
      });
    }
  };

  const memberMap = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  // Deleting your own entries: the first tap arms the button ("Delete"),
  // the second removes the entry. It disarms itself after a few seconds.
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const removeEntry = async (id: string) => {
    setConfirming(null);
    setDeleteError(null);
    const removed = entries.find((e) => e.id === id);
    // Marked first so a refetch already in flight cannot put it back.
    deletedIds.current.add(id);
    liveRows.current.delete(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    const err = await deleteEntry(id);
    if (err) {
      deletedIds.current.delete(id);
      // Put it back where it was (newest first), unless a refetch that
      // landed meanwhile already has it.
      if (removed) {
        setEntries((prev) =>
          prev.some((e) => e.id === id) ? prev : [...prev, removed].sort(byNewest),
        );
      }
      setDeleteError(err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    // Today keeps its own list while this tab is up; tell it to refetch.
    markEntriesChanged();
  };

  const onDelete = (id: string) => {
    if (confirming === id) void removeEntry(id);
    else setConfirming(id);
  };

  // "Today" from the ticking clock, never a bare Date.now() in render: the
  // React Compiler would freeze it and a resident tab would think it is
  // yesterday after midnight.
  const today = localDate(now, tz);
  const loggedTodayIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (localDate(e.logged_at, tz) === today) s.add(e.user_id);
    }
    return s;
  }, [entries, tz, today]);

  // One card per person per day, same-type entries merged into one line
  // (src/lib/feedGroups.ts). Cards open up to show the individual entries.
  // The feed loads the last 30×24 hours, so its oldest local day is cut
  // part-way; with day totals on each card that would show a wrong total.
  // Keep only whole days (the last 30 calendar days, today included).
  const days = useMemo(() => {
    const floor = lastNDaysEndingOn(today, 30)[0];
    return groupFeed(entries, tz).filter((d) => d.ymd >= floor);
  }, [entries, tz, today]);

  const toggleCard = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const yesterday = lastNDaysEndingOn(today, 2)[0];
  const dayHeading = (ymd: string) =>
    ymd === today ? "Today" : ymd === yesterday ? "Yesterday" : dayLabel(ymd);

  if (membership === null && circleCheck === "none") {
    // Root is a plain View here, so it pads the status bar itself.
    return (
      <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.canvas }]}>
        <Placeholder
          icon={Users}
          title="Feed"
          note="You’re not in a circle yet. Ask the group owner to add you, then your circle’s activity shows up here."
        />
      </View>
    );
  }

  // The web had its data at first paint. Here the header shows at once and
  // the body follows the first fetch, so the strip never flashes "0 of 0"
  // and the empty state never flashes before the rows.
  // A failed circle lookup is a failed load too, never "not in a circle".
  const circleFailed = membership === null && circleCheck === "error";
  const showBody = loadState !== "loading" || circleFailed;
  const loadFailed = loadState === "failed" || circleFailed;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: c.canvas }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: Platform.OS === "ios" ? 0 : insets.top },
      ]}
      refreshControl={
        groupId || membership === null ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} />
        ) : undefined
      }
    >
      {/* Header. The member count waits for the members list rather than
          flashing "0 members" (the web had the list at first paint). */}
      <View style={styles.header}>
        {membership && members.length > 0 ? (
          <Text style={[Type.footnote, styles.upper, { color: c.faint }]}>
            {groupName} · {members.length} {members.length === 1 ? "member" : "members"}
          </Text>
        ) : null}
        <Text style={[Type.display, styles.title, { color: c.foreground }]}>Feed</Text>
      </View>

      {showBody && loadFailed && (
        <View style={styles.failed}>
          <EmptyState
            icon={WifiOff}
            title="Couldn’t load the feed"
            note="Check your connection and try again."
          />
          <Button variant="secondary" size="md" onPress={() => void reload()} style={styles.retry}>
            Try again
          </Button>
        </View>
      )}

      {showBody && !loadFailed && userId && (
        <View style={styles.sections}>
          {/* Logged-today strip */}
          <LoggedTodayStrip
            members={members}
            loggedTodayIds={loggedTodayIds}
            userId={userId}
            cooldownLeft={cooldownLeft}
            onNudge={nudge}
          />

          {refreshError && (
            <View style={[styles.banner, { backgroundColor: c.dangerTint }]}>
              <Text style={[Type.footnote, { color: c.danger }]}>{refreshError}</Text>
            </View>
          )}
          {deleteError && (
            <View style={[styles.banner, { backgroundColor: c.dangerTint }]}>
              <Text style={[Type.footnote, { color: c.danger }]}>{deleteError}</Text>
            </View>
          )}

          {/* Feed. The web tested entries.length; days.length also covers
              entries that all fall outside the whole-day floor, which would
              otherwise draw nothing at all. */}
          {days.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No activity yet"
              note="When your circle logs, it shows up here. Be the first today."
            />
          ) : (
            days.map(({ ymd, cards }) => (
              <View key={ymd}>
                <Text style={[Type.footnote, styles.upper, styles.dayHeading, { color: c.faint }]}>
                  {dayHeading(ymd)}
                </Text>
                <View style={styles.cards}>
                  {cards.map((card) => {
                    const key = `${ymd}:${card.user_id}`;
                    return (
                      <FeedCardView
                        key={key}
                        card={card}
                        member={memberMap.get(card.user_id)}
                        isMe={card.user_id === userId}
                        tz={tz}
                        expanded={open.has(key)}
                        onToggle={() => toggleCard(key)}
                        confirming={confirming}
                        onDelete={onDelete}
                      />
                    );
                  })}
                </View>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: LIST_BOTTOM_CLEARANCE },
  // Web: px-5 pt-7 pb-3 (the horizontal padding is on the container).
  header: { paddingTop: 28, paddingBottom: 12 },
  upper: { fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.6 },
  title: { marginTop: 4 },
  // Web: the strip, then the feed mt-5 space-y-5.
  sections: { gap: 20 },
  // Web: mb-2 px-1.
  dayHeading: { marginBottom: 8, paddingHorizontal: 4 },
  // Web: space-y-2.5.
  cards: { gap: 10 },
  // Web: rounded-lg bg-danger-tint px-3 py-2.
  banner: {
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  failed: { alignItems: "center" },
  retry: { marginTop: 16 },
});
