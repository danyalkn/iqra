import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Activity,
  BookMarked,
  CalendarCheck,
  CalendarDays,
  ChartColumnBig,
  Clock3,
  Flag,
  Flame,
  Hourglass,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  AppState,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Placeholder } from "@/components/Placeholder";
import { CoverageSheet } from "@/components/stats/CoverageSheet";
import { Heatmap, type HeatCell } from "@/components/stats/Heatmap";
import { HifzBreakdownCard } from "@/components/stats/HifzBreakdownCard";
import { InsightsCard, type InsightLine } from "@/components/stats/InsightsCard";
import { JournalLink } from "@/components/stats/JournalLink";
import { KhatmahCard } from "@/components/stats/KhatmahCard";
import { Leaderboard } from "@/components/stats/Leaderboard";
import { MonthBrowser } from "@/components/stats/MonthBrowser";
import { PagesBarChart } from "@/components/stats/PagesBarChart";
import { ProgressCard } from "@/components/stats/ProgressCard";
import { ReadingWeeksCard } from "@/components/stats/ReadingWeeksCard";
import { RecapCard } from "@/components/stats/RecapCard";
import { EmptyNote, SectionCard } from "@/components/stats/SectionCard";
import { StatTile } from "@/components/stats/StatTile";
import type { BarDatum } from "@/components/stats/types";
import { Button, SegmentedControl, type Segment } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useMembership } from "@/hooks/use-membership";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { getGroupPagesAllTime, getMyEntriesAllTime } from "@/lib/data";
import {
  addMonths,
  addWeeks,
  currentStreak,
  localDate,
  longestStreak,
  monthDates,
  monthKey,
  monthLabel,
  shortDate,
  startOfWeek,
  weekDates,
  weekDatesUpTo,
  weekRangeLabel,
} from "@/lib/dates";
import { isReadingType, type Mode } from "@/lib/entries";
import {
  buildAdvice,
  buildPersonalInsights,
  computeSignals,
  pagesByDay,
  weekBaseline,
  type InsightKind,
} from "@/lib/insights";
import { KHATMAH_PAGES } from "@/lib/khatmah";
import { pageFromRef, surahForPage, type MushafId } from "@/lib/mushaf";
import type { GroupMember, LogRow, ReadingRow } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

type Scope = "mine" | "group";
type Filter = "all" | "sabak" | "sabak_para" | "dor";

// Icon per personal-insight kind (trend swaps up/down at the call site).
const INSIGHT_ICONS: Record<InsightKind, LucideIcon> = {
  trend: TrendingUp,
  outlierWeek: Activity,
  streak: Flame,
  consistency: CalendarCheck,
  nextJuz: BookMarked,
  weekday: CalendarDays,
  timeOfDay: Clock3,
  bestWeek: Trophy,
  month: CalendarDays,
  eta: Flag,
};

const FILTER_SEGMENTS: Segment<Filter>[] = [
  { value: "all", label: "All" },
  { value: "sabak", label: "Sabak" },
  { value: "sabak_para", label: "Sabak Para" },
  { value: "dor", label: "Dhor" },
];

// The web printed the scope keys with CSS `capitalize`.
const SCOPE_SEGMENTS: Segment<Scope>[] = [
  { value: "mine", label: "Mine" },
  { value: "group", label: "Group" },
];

const pagesOf = (rows: { pages_equiv: number | null }[]) =>
  +rows.reduce((s, e) => s + (e.pages_equiv ? +e.pages_equiv : 0), 0).toFixed(1);

/** A search param as one string. Expo Router can hand back an array for a
 *  repeated key, and a param cleared with setParams may come back as "". */
function oneParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : null;
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** What the web page loaded on the server for StatsClient, in one piece so
 *  a refresh swaps all four lists together (a leaderboard built from new
 *  members and old rows would read wrong for a frame). */
type StatsData = {
  members: GroupMember[];
  entries: LogRow[];
  readingAll: ReadingRow[];
  mine: LogRow[];
};

const EMPTY: StatsData = { members: [], entries: [], readingAll: [], mine: [] };

// Throwing versions of getGroupMembers and getGroupEntries (src/lib/data.ts).
// The shared ones drop `error` and return [], which Feed and Chat can live
// with, but here a failed read would land as a circle with no members and no
// entries (streak 0, empty heatmap and leaderboard) and overwrite good cards
// on a refresh. Same queries, same shapes; fold them back into src/lib once
// the shared functions throw (a shared-lib change the web repo must mirror).
async function getGroupMembersStrict(groupId: string): Promise<GroupMember[]> {
  const { data: rows, error } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  if (error) throw error;
  const ids = ((rows as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
  if (ids.length === 0) return [];

  // A failed profiles read would otherwise name everyone "Member".
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  if (profilesError) throw profilesError;
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

async function getGroupEntriesStrict(groupId: string, sinceDays: number): Promise<LogRow[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data as LogRow[] | null) ?? [];
}


/** First load: not started, landed, or failed before ever landing. Once
 *  "ready" it stays ready; later refreshes that fail keep the cards and show
 *  a banner instead (same shape as Today). */
type LoadState = "loading" | "ready" | "failed";

const REFRESH_ERROR = "Couldn’t refresh your insights. Pull down to try again.";

/** Gap kept above the recap card when the Sunday push scrolls to it (web:
 *  scroll-mt-4). */
const RECAP_SCROLL_MARGIN = 16;

/**
 * Insights (reference/web-pwa/app/(app)/stats/page.tsx + StatsClient.tsx).
 *
 * The web page fetched members, the 180-day group entries, the all-time
 * page rows and the user's all-time entries on the server and handed them
 * to the client. Native loads them here once membership resolves and again
 * on every focus, because Today and the Journal change entries while this
 * tab stays mounted under NativeTabs. Every derived number below is the
 * web's, line for line; only the data plumbing, the scroll-to-recap and the
 * chart components (victory-native, owned by src/components/stats/*Card)
 * differ.
 */
export default function StatsScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile } = useSession();
  const { membership, refresh: refreshMembership } = useMembership();
  const params = useLocalSearchParams<{ section?: string }>();

  const userId = user?.id ?? "";
  const mode: Mode = profile?.mode ?? "reading";
  const tz = profile?.timezone || deviceTimeZone();
  const mushaf: MushafId = profile?.mushaf ?? "uthmani15";
  // undefined while loading, null when not in a circle yet.
  const groupId = membership?.group_id ?? null;

  const reading = mode === "reading";

  const [data, setData] = useState<StatsData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<Scope>("mine");
  const [showCoverage, setShowCoverage] = useState(false);

  // The current load state for callbacks that must not re-run when it
  // changes (a focus effect keyed on loadState would retry in a loop).
  const loadStateRef = useRef<LoadState>("loading");
  useEffect(() => {
    loadStateRef.current = loadState;
  }, [loadState]);
  // Only the newest request may land: a reload started later (refresh,
  // focus, foreground return) supersedes one still in flight.
  const loadSeq = useRef(0);

  // Whether this tab is the one on screen, for the foreground-return reload.
  const focusedRef = useRef(false);
  // The membership answer for focus and foreground callbacks that must not
  // re-run (and re-fetch) when it changes.
  const membershipRef = useRef(membership);
  useEffect(() => {
    membershipRef.current = membership;
  }, [membership]);

  // All four reads throw on an error (getGroupPagesAllTime and
  // getMyEntriesAllTime through fetchAll, the members and 180-day entries
  // through the strict copies above), so one failed request fails the whole
  // load instead of landing as an empty circle.
  const loadStats = useCallback((): Promise<void> => {
    if (!groupId || !userId) return Promise.resolve();
    const seq = ++loadSeq.current;
    // Promise callbacks rather than await: every setState below then sits in
    // a continuation, which is what the set-state-in-effect lint rule wants
    // from a loader the mount effect calls (same shape as Today's loadToday).
    return Promise.all([
      getGroupMembersStrict(groupId),
      getGroupEntriesStrict(groupId, 180),
      getGroupPagesAllTime(supabase, groupId),
      getMyEntriesAllTime(supabase, groupId, userId),
    ]).then(
      ([members, entries, readingAll, mine]) => {
        if (seq !== loadSeq.current) return;
        setData({ members, entries, readingAll, mine });
        setError(null);
        setLoadState("ready");
      },
      () => {
        if (seq !== loadSeq.current) return;
        if (loadStateRef.current === "ready") {
          // The cards on screen are still good; say so and let the next
          // focus or pull try again.
          setError(REFRESH_ERROR);
        } else {
          setLoadState("failed");
        }
      },
    );
  }, [groupId, userId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // A null membership is a confirmed answer (useMembership never caches a
  // failed read), but the owner can add a member while this tab sits on the
  // placeholder, so re-ask while the answer is null on focus and foreground.
  const retryMembership = useCallback(() => {
    if (membershipRef.current === null) refreshMembership().catch(() => {});
  }, [refreshMembership]);

  // Back from the background: other members may have logged and the week
  // windows may have rolled, so the tab on screen reloads (the web re-ran the
  // page on every visit). A load that never landed gets another go even when
  // the tab is not focused; the OS may have killed the sockets meanwhile.
  // loadSeq drops whichever request is superseded.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (focusedRef.current) retryMembership();
      if (focusedRef.current || loadStateRef.current === "failed") void loadStats();
    });
    return () => sub.remove();
  }, [loadStats, retryMembership]);

  // Entries logged on Today or edited in the Journal must show here without
  // a manual refresh (the web re-ran the page on every navigation). The
  // mount effect above covers the first focus, so a load still in flight is
  // left alone.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      retryMembership();
      if (loadStateRef.current !== "loading") void loadStats();
      return () => {
        focusedRef.current = false;
      };
    }, [loadStats, retryMembership]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadStats();
    } finally {
      setRefreshing(false);
    }
  }, [loadStats]);

  const onRefreshMembership = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshMembership();
    } catch {
      // Still null; the placeholder stays and the next pull tries again.
    } finally {
      setRefreshing(false);
    }
  }, [refreshMembership]);

  const { members, entries, readingAll, mine } = data ?? EMPTY;
  const memberCount = members.length;

  // Day-derived values come from a ticking clock, not a bare Date.now(): the
  // React Compiler would freeze todayLocal(tz) on tz alone, and this tab
  // stays mounted across midnight.
  const now = useNow();
  const today = localDate(now, tz);

  const scoped = useMemo(
    () => (scope === "mine" ? entries.filter((e) => e.user_id === userId) : entries),
    [entries, scope, userId],
  );
  // Readers have one category. Memorizers filter by All / Sabak / Sabak Para /
  // Dhor - reading entries only appear under All.
  const chartEntries = useMemo(() => {
    // The type filter only exists in personal hifz view; never let a stale
    // value silently filter the group heatmap.
    if (reading || scope === "group" || filter === "all") return scoped;
    return scoped.filter((e) => e.entry_type === filter);
  }, [scoped, filter, reading, scope]);

  // Streak from the user's own entries.
  const mineDays = useMemo(
    () =>
      new Set(entries.filter((e) => e.user_id === userId).map((e) => localDate(e.logged_at, tz))),
    [entries, userId, tz],
  );
  const streak = currentStreak(mineDays, tz, now);
  const longest = longestStreak(mineDays);

  // Heatmap: entries per day over the last 5 calendar weeks (Mon–Sun rows),
  // ending with the current, partly-finished week. Whole weeks rather than a
  // rolling 35 days, so the columns line up with real weekdays.
  const heatGrid = useMemo<HeatCell[]>(() => {
    const byDay = new Map<string, number>();
    for (const e of chartEntries) {
      const d = localDate(e.logged_at, tz);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    // Pick the rendered days first, then scale intensity to the busiest of
    // *those*. Scaling against every day in the 180-day entries window would
    // let one heavy day months ago (Ramadan, say) flatten the visible weeks
    // into a uniform wash.
    const days: (string | null)[] = [];
    for (let w = 4; w >= 0; w--) {
      for (const d of weekDates(addWeeks(today, -w))) {
        // Days after today in the current week stay blank.
        days.push(d > today ? null : d);
      }
    }
    const max = Math.max(1, ...days.map((d) => (d === null ? 0 : (byDay.get(d) ?? 0))));
    return days.map((d) => {
      if (d === null) return null;
      const n = byDay.get(d) ?? 0;
      return { date: d, count: n, op: n === 0 ? 0 : 0.3 + 0.7 * (n / max) };
    });
  }, [chartEntries, tz, today]);

  // Weekly trend: real calendar weeks (Mon–Sun), last 8 including this one.
  // The current week is partial by design - it runs Monday → today.
  const weeklyBar = useMemo<BarDatum[]>(() => {
    const byDay = new Map<string, number>();
    for (const e of chartEntries) {
      const d = localDate(e.logged_at, tz);
      byDay.set(d, (byDay.get(d) ?? 0) + (e.pages_equiv ? +e.pages_equiv : 0));
    }
    const out: BarDatum[] = [];
    for (let w = 7; w >= 0; w--) {
      const monday = addWeeks(today, -w);
      const dates = weekDatesUpTo(monday, today);
      const pages = +dates.reduce((s, d) => s + (byDay.get(d) ?? 0), 0).toFixed(1);
      const range = weekRangeLabel(monday, dates[dates.length - 1]);
      out.push({
        label: shortDate(monday),
        // Say so when the last bar is a week still in progress.
        full: dates.length < 7 ? `${range} · so far` : range,
        pages,
      });
    }
    return out;
  }, [chartEntries, tz, today]);
  const weeklyTotal = +weeklyBar.reduce((s, w) => s + w.pages, 0).toFixed(1);

  // This calendar week so far: Monday → today.
  const thisWeekDates = useMemo(() => weekDatesUpTo(today, today), [today]);

  const loggedTodayCount = useMemo(
    () =>
      new Set(entries.filter((e) => localDate(e.logged_at, tz) === today).map((e) => e.user_id))
        .size,
    [entries, tz, today],
  );
  const weekCount = useMemo(() => {
    const days = new Set(thisWeekDates);
    return scoped.filter((e) => days.has(localDate(e.logged_at, tz))).length;
  }, [scoped, tz, thisWeekDates]);

  const totalEntries = chartEntries.length;
  const noteCount = useMemo(() => mine.filter((e) => e.notes).length, [mine]);
  // A memorizer who never logs plain reading has no use for the reading card.
  const readsToo = useMemo(() => mine.some((e) => isReadingType(e.entry_type)), [mine]);

  // ── Group khatmah (all-time, every entry type) ──────────────────────────
  // pages_equiv already converts juz/quarter/hizb → pages; page amounts are
  // raw pages; ayah-only entries contribute nothing.
  const groupRead = pagesOf(readingAll);
  const khatmahs = Math.floor(groupRead / KHATMAH_PAGES);
  const khatmahProgress = +(groupRead - khatmahs * KHATMAH_PAGES).toFixed(1);

  // ── Month browsing ────────────────────────────────────────────────────────
  // readingAll carries every page-bearing entry ever (no date window), so any
  // past month can be shown from data already on the client.
  // The web remounted on every visit, so it always opened on the current
  // month. This tab stays mounted, so the pick is stored as an override of
  // the current month (null = this month): it clears on every focus, and
  // "this month" follows the clock across a month rollover instead of
  // sticking on the month the tab was opened in.
  const thisMonth = monthKey(today);
  const [monthPick, setMonthPick] = useState<string | null>(null);
  const month = monthPick ?? thisMonth;
  const isThisMonth = month === thisMonth;
  const goToMonth = (key: string) => setMonthPick(key === thisMonth ? null : key);
  useFocusEffect(useCallback(() => setMonthPick(null), []));

  /** Local month key of each row, computed once - the timezone conversion is
   *  the expensive part and every month view needs it. */
  const readingByMonth = useMemo(() => {
    const out = new Map<string, { user_id: string; date: string; pages: number }[]>();
    let earliest = thisMonth;
    for (const r of readingAll) {
      const pages = r.pages_equiv ? +r.pages_equiv : 0;
      if (!pages) continue;
      const date = localDate(r.logged_at, tz);
      const key = monthKey(date);
      if (key < earliest) earliest = key;
      const bucket = out.get(key);
      if (bucket) bucket.push({ user_id: r.user_id, date, pages });
      else out.set(key, [{ user_id: r.user_id, date, pages }]);
    }
    return { byMonth: out, earliest };
  }, [readingAll, tz, thisMonth]);

  // Don't let the user page back past the first month with any data.
  const canGoBack = month > readingByMonth.earliest;

  // ── All-time & selected-month totals (true all-time: readingAll has no date
  // window, unlike `entries` which is capped at 180 days) ───────────────────
  const totals = useMemo(() => {
    const rowsFor = (key: string) => readingByMonth.byMonth.get(key) ?? [];
    const sumBy = (key: string) => {
      const per = new Map<string, number>();
      let total = 0;
      for (const r of rowsFor(key)) {
        per.set(r.user_id, (per.get(r.user_id) ?? 0) + r.pages);
        total += r.pages;
      }
      return { per, total };
    };

    const selected = sumBy(month);
    const previous = sumBy(addMonths(month, -1));

    const allTime = new Map<string, number>();
    for (const rows of readingByMonth.byMonth.values()) {
      for (const r of rows) {
        allTime.set(r.user_id, (allTime.get(r.user_id) ?? 0) + r.pages);
      }
    }

    const board = members
      .map((m) => ({
        member: m,
        all: +(allTime.get(m.user_id) ?? 0).toFixed(1),
        month: +(selected.per.get(m.user_id) ?? 0).toFixed(1),
      }))
      .sort((a, b) => b.month - a.month || b.all - a.all);

    return {
      board,
      maxMonth: Math.max(1, ...board.map((b) => b.month)),
      myAll: +(allTime.get(userId) ?? 0).toFixed(1),
      myMonth: +(selected.per.get(userId) ?? 0).toFixed(1),
      myPrevMonth: +(previous.per.get(userId) ?? 0).toFixed(1),
      groupMonth: +selected.total.toFixed(1),
      groupPrevMonth: +previous.total.toFixed(1),
    };
  }, [readingByMonth, members, userId, month]);

  // Pages per day across the selected month (capped at today for this month).
  const monthBar = useMemo<BarDatum[]>(() => {
    const rows = readingByMonth.byMonth.get(month) ?? [];
    const onlyMine = scope === "mine";
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (onlyMine && r.user_id !== userId) continue;
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.pages);
    }
    return monthDates(month, isThisMonth ? today : undefined).map((d) => ({
      label: String(+d.slice(8, 10)),
      full: shortDate(d),
      pages: +(byDay.get(d) ?? 0).toFixed(1),
    }));
  }, [readingByMonth, month, scope, userId, isThisMonth, today]);

  const monthPages = +monthBar.reduce((s, d) => s + d.pages, 0).toFixed(1);
  const monthActiveDays = monthBar.filter((d) => d.pages > 0).length;
  const monthName = monthLabel(month, today);
  const prevMonthName = monthLabel(addMonths(month, -1), today);

  // ── Personal insights + advice (mine scope) ───────────────────────────────
  // Signals + phrasing live in src/lib/insights.ts (pure, shared).
  // Seed = user + week Monday: stable within a week, rotates the next.
  const personal = useMemo(() => {
    const mineRecent = entries.filter((e) => e.user_id === userId);
    const mineAllTime = readingAll.filter((r) => r.user_id === userId);
    const signals = computeSignals({
      mine: mineRecent,
      mineAllTime,
      mineDays,
      streak,
      longestStreak: longest,
      tz,
      today,
    });
    const seedBase = `${userId.slice(0, 8)}:${startOfWeek(today)}`;
    return {
      signals,
      insights: buildPersonalInsights(signals, {
        seedBase,
        includeEta: !reading,
      }),
      advice: buildAdvice(signals, seedBase),
    };
  }, [entries, readingAll, userId, mineDays, streak, longest, tz, today, reading]);

  // ── Week recap (mine scope; the Sunday push deep-links here) ──────────────
  const recap = useMemo(() => {
    const monday = startOfWeek(today);
    const days = weekDates(monday).map((d) => ({
      d,
      logged: mineDays.has(d),
      future: d > today,
      isToday: d === today,
    }));
    const mineRecent = entries.filter((e) => e.user_id === userId);
    const weekSet = new Set(weekDatesUpTo(monday, today));
    const refs = mineRecent
      .filter(
        (e) =>
          (e.entry_type === "reading" || e.entry_type === "revising") &&
          e.to_ref &&
          weekSet.has(localDate(e.logged_at, tz)),
      )
      .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
    const firstPage = refs.length ? pageFromRef(refs[0].to_ref) : null;
    const lastRef = refs.length ? refs[refs.length - 1] : null;
    const lastPage = lastRef ? pageFromRef(lastRef.to_ref) : null;
    return {
      monday,
      label: weekRangeLabel(monday, days[6].d),
      days,
      activeDays: days.filter((x) => x.logged).length,
      movement:
        firstPage != null && lastPage != null && lastRef
          ? {
              from: firstPage,
              to: lastPage,
              surah: surahForPage(lastRef.mushaf ?? "uthmani15", lastPage).name,
            }
          : null,
    };
  }, [entries, userId, mineDays, tz, today]);

  // ── Scroll to the recap ───────────────────────────────────────────────────
  // The Sunday push lands on /stats#recap on the web (scrollIntoView after
  // paint); natively it arrives as /stats?section=recap (src/lib/deepLinks)
  // and the card's position is read off its onLayout. The recap only
  // renders in "mine" scope, so a link that finds the tab parked on "group"
  // flips it back; the position is dropped whenever the card leaves so a
  // stale y can never be scrolled to. Both adjust state during render (the
  // lint rule forbids a synchronous setState in an effect body).
  const wantRecap = oneParam(params.section) === "recap";
  const [seenRecap, setSeenRecap] = useState(wantRecap);
  const [recapY, setRecapY] = useState<number | null>(null);
  if (wantRecap !== seenRecap) {
    setSeenRecap(wantRecap);
    if (wantRecap && scope !== "mine") setScope("mine");
  }
  if (scope !== "mine" && recapY != null) setRecapY(null);
  const onRecapLayout = useCallback((e: LayoutChangeEvent) => {
    setRecapY(e.nativeEvent.layout.y);
  }, []);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const recapReady = wantRecap && loadState === "ready" && scope === "mine" && recapY != null;
  const insetTop = insets.top;
  useEffect(() => {
    if (!recapReady || recapY == null) return;
    // After paint, so layout is settled before we scroll (web: rAF).
    const id = requestAnimationFrame(() => {
      // recapY is measured inside the content container, and scrollTo takes
      // a content offset whose 0 is the screen top on both platforms: the
      // view runs under the status bar, content insets are off, and the
      // container pads by insetTop itself. Subtract the inset so the margin
      // is kept below the safe area; 0 is the resting (fully scrolled up)
      // offset.
      scrollRef.current?.scrollTo({
        y: Math.max(0, recapY - insetTop - RECAP_SCROLL_MARGIN),
        animated: true,
      });
      // Consume the link: setParams merges, and an undefined value reads
      // back as absent, so a re-focus never scrolls again.
      router.setParams({ section: undefined });
    });
    return () => cancelAnimationFrame(id);
  }, [recapReady, recapY, insetTop]);
  // Not in a circle: nothing to scroll to, drop the link all the same.
  useEffect(() => {
    if (wantRecap && membership === null) router.setParams({ section: undefined });
  }, [wantRecap, membership]);

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights = useMemo<InsightLine[]>(() => {
    // Calendar weeks (Mon-based). The current week is partial, so compare it
    // against the *same span* of last week - "Mon–Wed vs Mon–Wed" - otherwise
    // every Monday would look like a collapse against a full 7-day week.
    const week = new Set(thisWeekDates);
    const prevWeek = new Set(weekDates(addWeeks(today, -1)).slice(0, thisWeekDates.length));
    const out: InsightLine[] = [];

    const pagesIn = (rows: LogRow[], days: Set<string>) =>
      pagesOf(rows.filter((e) => days.has(localDate(e.logged_at, tz))));

    if (scope === "mine") {
      const minRows = entries.filter((e) => e.user_id === userId);
      // The generic personal lines (trend, streak, consistency, patterns,
      // ETA) come from src/lib/insights.ts via the `personal` memo - this
      // branch only contributes the hifz-specific revision reads.

      // Most revised juz (structured logging).
      const revRows = minRows.filter(
        (e) => (e.entry_type === "sabak_para" || e.entry_type === "dor") && e.juz != null,
      );
      if (revRows.length > 0) {
        const byJuz = new Map<number, number>();
        for (const e of revRows) byJuz.set(e.juz!, (byJuz.get(e.juz!) ?? 0) + 1);
        const [topJuz, topN] = [...byJuz.entries()].sort((a, b) => b[1] - a[1])[0];
        out.push({
          key: "hifz-top",
          icon: BookMarked,
          text: `Most revised: **Juz ${topJuz}**`,
          note: `${topN}×`,
        });

        // Longest-untouched juz you do revise.
        if (byJuz.size > 1) {
          const lastSeen = new Map<number, string>();
          for (const e of revRows) {
            const d = localDate(e.logged_at, tz);
            const cur = lastSeen.get(e.juz!);
            if (!cur || d > cur) lastSeen.set(e.juz!, d);
          }
          const [staleJuz, staleDate] = [...lastSeen.entries()].sort((a, b) =>
            a[1] < b[1] ? -1 : 1,
          )[0];
          const staleDays = Math.floor(
            (new Date(`${today}T12:00:00`).getTime() -
              new Date(`${staleDate}T12:00:00`).getTime()) /
              86400000,
          );
          if (staleDays >= 10) {
            out.push({
              key: "hifz-stale",
              icon: Hourglass,
              text: `**Juz ${staleJuz}** hasn’t been revised in **${staleDays}** days`,
            });
          }
        }
      }
    } else {
      const activeMembers = new Set(
        entries.filter((e) => week.has(localDate(e.logged_at, tz))).map((e) => e.user_id),
      ).size;
      out.push({
        key: "group-active",
        icon: Users,
        text: `**${activeMembers}** of **${memberCount}** logged this week`,
      });

      // Same correction as the personal trend: the circle pushes hard in the
      // last week of the month, so a plain week-over-week number reads as a
      // crash the week after. The bar is a typical week instead
      // (src/lib/insights.ts → weekBaseline).
      const thisW = pagesIn(entries, week);
      const lastW = pagesIn(entries, prevWeek);
      const base = weekBaseline(pagesByDay(entries, tz), today, thisWeekDates.length);
      const usual = base.weeks >= 3 && base.typicalSpan > 0 ? base.typicalSpan : null;
      out.push({
        key: "group-pages",
        icon: thisW >= (usual ?? lastW) ? TrendingUp : TrendingDown,
        text: `**${thisW}** group pages this week`,
        note: usual != null ? `${usual} is typical by now` : `${lastW} same days last week`,
        delta:
          thisW === 0
            ? null
            : usual != null
              ? (thisW - usual) / usual
              : lastW > 0
                ? (thisW - lastW) / lastW
                : null,
      });

      // Call a push a push, so next week's number isn't read as a slump.
      if (base.lastWeek?.outlier === "high" && thisW < base.lastWeek.pages) {
        out.push({
          key: "group-push",
          icon: Activity,
          text: `Last week was a push: **${base.lastWeek.pages}** pages`,
          note: `${base.typicalWeek} in a typical week`,
        });
      }

      // Top contributor this week.
      const byUser = new Map<string, number>();
      for (const e of entries) {
        if (!week.has(localDate(e.logged_at, tz))) continue;
        byUser.set(e.user_id, (byUser.get(e.user_id) ?? 0) + (e.pages_equiv ? +e.pages_equiv : 0));
      }
      const top = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0) {
        const name =
          top[0] === userId
            ? "You"
            : (members.find((m) => m.user_id === top[0])?.display_name ?? "Someone");
        out.push({
          key: "group-top",
          icon: Trophy,
          text: `Most pages this week: **${name}**`,
          note: `${+top[1].toFixed(1)} pages`,
        });
      }
    }
    return out;
  }, [scope, entries, userId, tz, today, thisWeekDates, members, memberCount]);

  // The engine's personal lines in the InsightsCard shape, hifz extras after.
  const mineLines = useMemo<InsightLine[]>(
    () => [
      ...personal.insights.map((ins) => {
        const Icon = INSIGHT_ICONS[ins.kind] ?? CalendarCheck;
        const TrendIcon =
          ins.kind === "trend" ? ((ins.delta ?? 0) >= 0 ? TrendingUp : TrendingDown) : Icon;
        return {
          key: ins.kind,
          icon: TrendIcon,
          text: ins.text,
          delta: ins.delta,
        };
      }),
      ...insights,
    ],
    [personal.insights, insights],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  // Membership is shared and cached; "no circle" is re-asked on focus and
  // foreground return (retryMembership) and a pull re-asks at once, so a
  // member added by the owner does not stay on the placeholder.
  // Safe-area padding, the same for both lists below. Neither leans on
  // react-native-screens' automatic content insets: on iOS 26 the tab
  // screen gets none, which left the header under the clock and the last
  // row under the tab bar. So insets are off (contentInsetAdjustmentBehavior
  // "never") and the container pads them itself, as Today's root View does.
  // Top: the status bar / Dynamic Island on both platforms. Bottom: on iOS
  // the screen runs under the floating tab bar, so the home-indicator inset
  // is added to the 40 of air; Android's tab bar sits below the screen
  // (its SafeAreaView already clears it), so 40 alone.
  const insetPad = {
    paddingTop: insets.top,
    paddingBottom: 40 + (Platform.OS === "ios" ? insets.bottom : 0),
  };

  if (membership === null) {
    return (
      <ScrollView
        style={[styles.root, { backgroundColor: c.canvas }]}
        // Same insets as the main list below (see insetPad).
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.placeholder, insetPad]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefreshMembership}
            tintColor={c.muted}
          />
        }
      >
        <Placeholder
          icon={ChartColumnBig}
          title="Insights"
          note="You’re not in a circle yet. Once you’re added and start logging, your charts show up here."
        />
      </ScrollView>
    );
  }

  // The web had its data at first paint. Here the header shows at once and
  // the cards follow the first fetch, so nothing flashes 0 before the rows.
  const showBody = loadState === "ready";
  const loadFailed = loadState === "failed";
  const group = scope === "group";

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={[styles.root, { backgroundColor: c.canvas }]}
        // Insets padded by the container, never by the system (see insetPad).
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.content, insetPad]}
        refreshControl={
          groupId ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} />
          ) : undefined
        }
      >
        <View style={styles.header}>
          <Text style={[Type.display, { color: c.foreground }]}>Insights</Text>
        </View>

        {loadFailed && (
          <View style={styles.failed}>
            <EmptyState
              icon={WifiOff}
              title="Couldn’t load your insights"
              note="Check your connection and try again."
            />
            <Button variant="secondary" size="md" onPress={() => void loadStats()}>
              Try again
            </Button>
          </View>
        )}

        {showBody && (
          <>
            <View style={styles.scopeRow}>
              <Text style={[Type.footnote, { color: c.faint }]}>
                {scope === "mine" ? "Your" : "Group"} activity
              </Text>
              <SegmentedControl
                segments={SCOPE_SEGMENTS}
                value={scope}
                onChange={setScope}
                style={styles.scopeControl}
              />
            </View>

            {error && (
              <View style={[styles.banner, { backgroundColor: c.dangerTint }]}>
                <Text style={[Type.footnote, { color: c.danger }]}>{error}</Text>
              </View>
            )}

            {/* ── MINE: week recap - the Sunday push deep-links here ── */}
            {scope === "mine" && (
              <RecapCard recap={recap} signals={personal.signals} onLayout={onRecapLayout} />
            )}

            {/* Stat cards (web: a 2x2 grid with gap-3) */}
            <View style={styles.tiles}>
              {scope === "mine" ? (
                <>
                  <View style={styles.tileRow}>
                    <StatTile
                      label="All-time pages"
                      value={totals.myAll}
                      sub={`≈ ${Math.round(totals.myAll / 20)} juz`}
                      onInfo={() => setShowCoverage(true)}
                    />
                    <StatTile label="Current streak" value={streak} sub="days" />
                  </View>
                  <View style={styles.tileRow}>
                    <StatTile label="Longest streak" value={longest} sub="days" />
                    <StatTile
                      label="This week"
                      value={weekCount}
                      sub={`entries · since ${shortDate(thisWeekDates[0])}`}
                    />
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.tileRow}>
                    <StatTile
                      label="All-time pages"
                      value={groupRead}
                      sub={
                        khatmahs > 0
                          ? `${khatmahs} ${khatmahs === 1 ? "khatmah" : "khatmahs"} + ${Math.floor(khatmahProgress)} pages`
                          : "read together"
                      }
                      onInfo={() => setShowCoverage(true)}
                    />
                    <StatTile
                      label="Logged today"
                      value={`${loggedTodayCount}/${memberCount}`}
                      sub="members"
                    />
                  </View>
                  <View style={styles.tileRow}>
                    <StatTile
                      label="This week"
                      value={weekCount}
                      sub={`entries · since ${shortDate(thisWeekDates[0])}`}
                    />
                    <StatTile label="Khatmahs" value={khatmahs} sub="completed together" />
                  </View>
                </>
              )}
            </View>

            {/* ── MINE: where you are in the Quran, month by month ── */}
            {scope === "mine" && (
              <ProgressCard mode={mode} tz={tz} today={today} mushaf={mushaf} rows={mine} />
            )}

            {/* ── MINE (hifz): Sabak / Sabak Para / Dhor, in pages ── */}
            {!reading && scope === "mine" && (
              <HifzBreakdownCard rows={mine} tz={tz} today={today} />
            )}

            {/* ── MINE: juz of reading per week (memorizers who read too) ── */}
            {scope === "mine" && (reading || readsToo) && (
              <ReadingWeeksCard rows={mine} tz={tz} today={today} hifz={!reading} />
            )}

            {/* ── GROUP: the khatmah we're on + history of past ones ── */}
            {group && <KhatmahCard rows={readingAll} tz={tz} today={today} />}

            {/* ── Month browser: page back through any past month ── */}
            <MonthBrowser
              monthName={monthName}
              prevMonthName={prevMonthName}
              isThisMonth={isThisMonth}
              today={today}
              canGoBack={canGoBack}
              onPrev={() => goToMonth(addMonths(month, -1))}
              onNext={() => goToMonth(addMonths(month, 1))}
              group={group}
              pages={group ? totals.groupMonth : totals.myMonth}
              prevPages={group ? totals.groupPrevMonth : totals.myPrevMonth}
              monthActiveDays={monthActiveDays}
              monthPages={monthPages}
              monthBar={monthBar}
            />

            {/* ── GROUP: leaderboard - this month + all time per member ── */}
            {group && (
              <Leaderboard
                board={totals.board}
                maxMonth={totals.maxMonth}
                monthName={monthName}
                userId={userId}
              />
            )}

            {/* Insights - mine: the personal engine + hifz extras + one piece
                of advice; group: the aggregate lines. */}
            {scope === "mine" ? (
              <InsightsCard lines={mineLines} advice={personal.advice} />
            ) : (
              insights.length > 0 && <InsightsCard lines={insights} />
            )}

            {/* All / Sabak / Sabak Para / Dhor - hifz, personal scope only.
                It scopes the heatmap and weekly pages, so it sits right above
                them: at the top of the page (the web's spot) it was eight
                cards away from anything it changed and read as broken (owner,
                2026-10-17). */}
            {!reading && scope === "mine" && (
              <SegmentedControl segments={FILTER_SEGMENTS} value={filter} onChange={setFilter} />
            )}

            {/* Entries heatmap */}
            <Heatmap grid={heatGrid} totalEntries={totalEntries} />

            {/* ── MINE: weekly trend ── */}
            {scope === "mine" && (
              <SectionCard title="Weekly pages · last 8 weeks (Mon–Sun)">
                {weeklyTotal === 0 ? (
                  <EmptyNote>Log a few weeks of pages to see your trend here.</EmptyNote>
                ) : (
                  <PagesBarChart
                    data={weeklyBar}
                    height={150}
                    labelEvery={2}
                    maxBarWidth={26}
                    suffix="pages"
                  />
                )}
              </SectionCard>
            )}

            {/* ── MINE: notes live in the Journal ── */}
            {scope === "mine" && <JournalLink noteCount={noteCount} />}
          </>
        )}
      </ScrollView>

      {/* Where these numbers come from - totals only count what was logged. */}
      <CoverageSheet open={showCoverage} onClose={() => setShowCoverage(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  placeholder: { flexGrow: 1 },
  // Top and bottom padding come from insetPad (safe area + 40 at the end).
  content: { paddingHorizontal: 20, gap: 16 },
  // Web: pt-7 pb-3. The content gap (16) stands in for the bottom padding.
  header: { paddingTop: 28 },
  failed: { alignItems: "center", gap: 16 },
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scopeControl: { width: 150 },
  banner: {
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tiles: { gap: 12 },
  tileRow: { flexDirection: "row", gap: 12 },
});
