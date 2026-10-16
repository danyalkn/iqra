import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import {
  Bookmark,
  Inbox,
  NotebookPen,
  Settings as SettingsIcon,
  UserPlus,
  WifiOff,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Celebration } from "@/components/Celebration";
import { DayReminders, type DayRemindersHandle } from "@/components/DayReminders";
import { EmptyState } from "@/components/EmptyState";
import { EntryRow } from "@/components/EntryRow";
import { LogSheet } from "@/components/LogSheet";
import { SpeedDial } from "@/components/SpeedDial";
import { Card, SegmentedControl, type Segment } from "@/components/ui";
import { CLOSE_MS as SHEET_CLOSE } from "@/components/ui/Sheet";
import { Radius, Type } from "@/constants/theme";
import {
  deleteEntry,
  isMissingMushaf,
  markEntriesChanged,
  takeEntriesChanged,
  updateEntry,
} from "@/data/entryWrites";
import { useMembership } from "@/hooks/use-membership";
import { useTheme } from "@/hooks/use-theme";
import {
  currentStreak,
  hijriDate,
  localDate,
  longestStreak,
  todayLocal,
  tomorrowLocal,
} from "@/lib/dates";
import { isUuid } from "@/lib/deepLinks";
import {
  bucketOf,
  isReadingType,
  pagesEquiv,
  TYPES_BY_MODE,
  type EntryType,
  type Mode,
} from "@/lib/entries";
import {
  bookmarkLabel,
  DEFAULT_MUSHAF,
  pageFromRef,
  totalPages,
  type MushafId,
} from "@/lib/mushaf";
import type { DayReminder, LogRow, NewEntry } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { PREF_KEYS, readPref } from "@/storage/prefs";
import { supabase } from "@/supabase/client";

type Filter = "all" | "new" | "revision";

/** Session memory of reminder deep links already acted on, so the sheet
 *  opens once per notification tap and never again from Back or a re-focus.
 *  Keyed by reminder id; a link without one (typed by hand) always opens.
 *  The web kept this list in sessionStorage; native has no such thing, so a
 *  module-level Set lives exactly as long as the JS runtime (one app session)
 *  and keeps the same cap of 20 ids. */
const consumedDeepLinks = new Set<string>();
const CONSUMED_CAP = 20;

function deepLinkConsumed(key: string | null): boolean {
  return !!key && consumedDeepLinks.has(key);
}

function markDeepLinkConsumed(key: string | null): void {
  if (!key || consumedDeepLinks.has(key)) return;
  consumedDeepLinks.add(key);
  // Sets iterate in insertion order, so the first value is the oldest.
  while (consumedDeepLinks.size > CONSUMED_CAP) {
    const oldest = consumedDeepLinks.values().next().value;
    if (oldest == null) break;
    consumedDeepLinks.delete(oldest);
  }
}

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

/** Clearance under the list so the FAB never covers the last row (web:
 *  pb-28). The tab bar itself is not added here: on iOS react-native-screens
 *  switches the first scroll view in the screen's first-descendant chain to
 *  automatic content-inset adjustment, which already pads the tab bar and
 *  home indicator (RNSScrollViewHelper), and on Android expo-router wraps
 *  the tab screen in a SafeAreaView with the bottom edge applied. Adding
 *  insets.bottom on top would leave a large blank band at the end. */
const LIST_BOTTOM_CLEARANCE = 112;

/** Web: the FAB sits bottom-5 (20) from the page. On iOS the tab screen has
 *  its own SafeAreaProvider (expo-router NativeTabsView.ios), so
 *  insets.bottom there is the tab bar plus the home indicator and the FAB is
 *  absolutely positioned (no scroll-view inset helps it). On Android the
 *  SafeAreaView around the screen already ends above the tab bar. */
function fabBottomOffset(insetBottom: number): number {
  return Platform.OS === "ios" ? insetBottom + 20 : 20;
}

/** How long the LogSheet's Modal stays mounted while it slides out. */
const SHEET_CLOSE_MS = SHEET_CLOSE;

/** Wall clock as state so day-derived values (today, header date, Hijri
 *  date) recompute after local midnight while the tab stays mounted. The
 *  React Compiler memoizes a bare `todayLocal(tz)` on `tz` alone, and
 *  NativeTabs keeps this screen mounted for the whole session, so a resident
 *  Today tab would otherwise think it is yesterday until restart (the web
 *  had no compiler and remounted the page on every navigation). Ticks on the
 *  minute, on foreground return (JS timers sleep in the background) and on
 *  tab focus. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          arm();
        },
        60_000 - (Date.now() % 60_000) + 50,
      );
    };
    arm();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  return now;
}

/** Native-side reads that keep the error. The shared lib/data helpers (kept
 *  verbatim with the web) collapse a failed request into [], so a dropped
 *  connection would look like "never logged anything". The web could live
 *  with that: its server re-ran the queries on every visit and its client
 *  refetch checked `data &&`. Same select, filters and order as
 *  getMyRecentEntries / getMyDayReminders in src/lib/data.ts. */
async function fetchMyRecentEntries(
  groupId: string,
  userId: string,
  sinceDays = 120,
): Promise<{ rows: LogRow[] | null; error: boolean }> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("log_entries")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .gte("logged_at", since)
    .order("logged_at", { ascending: false });
  if (error) return { rows: null, error: true };
  return { rows: (data as LogRow[] | null) ?? [], error: false };
}

async function fetchMyDayReminders(
  userId: string,
  fromYmd: string,
  toYmd: string,
): Promise<{ rows: DayReminder[] | null; error: boolean }> {
  const { data, error } = await supabase
    .from("day_reminders")
    .select("*")
    .eq("user_id", userId)
    .gte("remind_on", fromYmd)
    .lte("remind_on", toYmd)
    .order("remind_on", { ascending: true })
    .order("time", { ascending: true });
  if (error) return { rows: null, error: true };
  return { rows: (data as DayReminder[] | null) ?? [], error: false };
}

/** First load of entries + reminders: not started, landed, or failed before
 *  ever landing. Once "ready" it stays ready; later refreshes that fail keep
 *  the list and show a banner instead. */
type LoadState = "loading" | "ready" | "failed";

const REFRESH_ERROR = "Couldn’t refresh your entries. Pull down to try again.";

/**
 * Today (reference/web-pwa/app/(app)/today/TodayClient.tsx + page.tsx).
 *
 * The web page fetched membership, entries and day reminders on the server
 * and handed them to the client as props. Native loads them here once
 * membership resolves, so every "initial" value the web took for granted is
 * async state below, and the deep link waits for the circle to be known.
 */
export default function TodayScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile } = useSession();
  const { membership } = useMembership();
  const params = useLocalSearchParams<{ log?: string; r?: string }>();

  const userId = user?.id ?? null;
  const mode: Mode = profile?.mode ?? "reading";
  const tz = profile?.timezone || deviceTimeZone();
  const mushaf: MushafId = profile?.mushaf ?? "uthmani15";
  // undefined while loading, null when not in a circle yet.
  const groupId = membership?.group_id ?? null;

  // A reminder push deep-links to /today?log=<type>&r=<reminder id> so the
  // log sheet opens straight away. Untrusted: only a type this mode actually
  // offers counts, and the id is only ever used as an opaque "opened once"
  // key.
  const log = oneParam(params.log);
  const r = oneParam(params.r);
  const openLog: EntryType | null =
    log && (TYPES_BY_MODE[mode] as string[]).includes(log) ? (log as EntryType) : null;
  const openLogKey = openLog && isUuid(r) ? r : null;

  const [entries, setEntries] = useState<LogRow[]>([]);
  // null until the first fetch lands: DayReminders owns its rows after
  // mount (useState(initial), as on the web), so it is mounted only once the
  // real list is here instead of being seeded with [] and ignoring the rest.
  // Later values are ignored by design (the section refetches on its own,
  // including on a timezone change), so it is set exactly once.
  const [dayReminders, setDayReminders] = useState<DayReminder[] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetType, setSheetType] = useState<EntryType>(
    openLog ?? (mode === "hifz" ? "sabak" : "reading"),
  );
  const [editingEntry, setEditingEntry] = useState<LogRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const remindersRef = useRef<DayRemindersHandle>(null);

  // A deep link opens the sheet from the first render on the web. Here
  // groupId arrives asynchronously, so the intent is held in state and acted
  // on once membership resolves. Both steps adjust state during render (the
  // React-sanctioned way to react to a prop change) rather than in an
  // effect, which the lint rule forbids. A new link (different type or id)
  // while this screen stays mounted - a second push tap - is seen the same
  // way; one already consumed is not.
  const linkId = openLog ? `${openLog}|${openLogKey ?? ""}` : null;
  const [seenLink, setSeenLink] = useState<string | null>(null);
  const [pendingLog, setPendingLog] = useState<EntryType | null>(null);
  if (linkId !== seenLink) {
    setSeenLink(linkId);
    if (openLog && !deepLinkConsumed(openLogKey)) setPendingLog(openLog);
  }
  // Release only once the rows are here (or the first fetch has given up):
  // the LogSheet freezes lastOfType at mount (its form key excludes it on
  // purpose), so opening before the first fetch would lose the hifz
  // continuation the web always had at first paint.
  if (pendingLog && (membership === null || loadState !== "loading")) {
    setPendingLog(null);
    // Not in a circle: nothing can be logged, drop the intent (web: the
    // initializer required groupId too).
    if (membership) {
      setEditingEntry(null);
      setSheetType(pendingLog);
      setSheetOpen(true);
    }
  }

  // Consume the deep link: remember it, then drop the query from the route.
  // The web stripped window.location with replaceState; native clears the
  // params in place (setParams merges, and an undefined value reads back as
  // absent), so Back or a re-focus never carries the link again.
  useEffect(() => {
    if (!openLog) return;
    markDeepLinkConsumed(openLogKey);
    router.setParams({ log: undefined, r: undefined });
  }, [openLog, openLogKey]);

  // The current load state for callbacks that must not re-run when it
  // changes (a focus effect keyed on loadState would retry in a loop).
  const loadStateRef = useRef<LoadState>("loading");
  useEffect(() => {
    loadStateRef.current = loadState;
  }, [loadState]);
  // Only the newest request may land: a reload started later (refresh, tz
  // change, focus) supersedes one still in flight, as the web's `cancelled`
  // flag did for its single refetch.
  const loadSeq = useRef(0);

  // The web page did this on the server: recent entries and today's +
  // tomorrow's one-time reminders in one go, once the circle is known. Here
  // it is also the retry for every surface below (focus, pull-to-refresh,
  // foreground return), so a failed first fetch does not stick for the
  // session: the shared helpers never reject, so the error must be read.
  const loadToday = useCallback((): Promise<void> => {
    if (!groupId || !userId) return Promise.resolve();
    const seq = ++loadSeq.current;
    return Promise.all([
      fetchMyRecentEntries(groupId, userId),
      fetchMyDayReminders(userId, todayLocal(tz), tomorrowLocal(tz)),
    ]).then(([recent, reminders]) => {
      if (seq !== loadSeq.current) return;
      if (recent.error || !recent.rows || reminders.error || !reminders.rows) {
        if (loadStateRef.current === "ready") {
          // The list on screen is still good; say so and let the next focus
          // try again (the web guarded this refetch with `data &&`).
          markEntriesChanged();
          setError(REFRESH_ERROR);
        } else {
          setLoadState("failed");
        }
        return;
      }
      const rows = reminders.rows;
      setEntries(recent.rows);
      setDayReminders((cur) => cur ?? rows);
      setLoadState("ready");
    });
  }, [groupId, userId, tz, setEntries, setDayReminders, setLoadState, setError]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  // The OS may have killed the sockets while the app was away; a load that
  // never landed gets another go on return.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && loadStateRef.current === "failed") void loadToday();
    });
    return () => sub.remove();
  }, [loadToday]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadToday();
    } finally {
      setRefreshing(false);
    }
  }, [loadToday]);

  // Confetti-on-reading preference (device-local; toggled in Settings).
  const [celebrateTick, setCelebrateTick] = useState(0);
  const celebrateOn = useRef(true);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
    },
    [],
  );

  // Back from the Journal after it edited or deleted entries: this screen
  // stayed mounted under the stack with its old list, so fetch a fresh one.
  // A first load that failed while the tab was away retries here too.
  // Settings may also have flipped the celebration toggle, so the pref is
  // re-read on every focus (the web read localStorage once per page load).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      readPref(PREF_KEYS.celebrate).then((v) => {
        if (active) celebrateOn.current = v !== "0";
      });
      if (loadStateRef.current === "failed" || takeEntriesChanged()) {
        void loadToday();
      }
      return () => {
        active = false;
      };
    }, [loadToday]),
  );

  const now = useNow();
  const today = localDate(now, tz);

  const loggedDays = useMemo(
    () => new Set(entries.map((e) => localDate(e.logged_at, tz))),
    [entries, tz],
  );
  const streak = currentStreak(loggedDays, tz);
  const longest = longestStreak(loggedDays);

  const todayEntries = useMemo(
    () => entries.filter((e) => localDate(e.logged_at, tz) === today),
    [entries, tz, today],
  );
  const filtered = todayEntries.filter((e) =>
    filter === "all" ? true : bucketOf(e.entry_type) === filter,
  );

  // Most recent reading bookmark → where to start next. We store the last page
  // read but show the *next* page to pick up from (wrapping to 1 after a khatm).
  // Resolve juz/surah in the mushaf that entry was logged in. Pick by
  // logged_at, not array position - a backdated entry may sit at the head
  // optimistically but must never become the bookmark.
  const lastReading = useMemo(() => {
    let best: LogRow | null = null;
    for (const x of entries) {
      if (!isReadingType(x.entry_type) || !x.to_ref) continue;
      if (!best || new Date(x.logged_at) > new Date(best.logged_at)) best = x;
    }
    return best;
  }, [entries]);
  // The newest entry of the type being logged: a fresh hifz entry carries on
  // from it (sabak continues right after the last one).
  const lastOfType = useMemo(() => {
    let best: LogRow | null = null;
    for (const x of entries) {
      if (x.entry_type !== sheetType) continue;
      if (!best || new Date(x.logged_at) > new Date(best.logged_at)) best = x;
    }
    return best;
  }, [entries, sheetType]);
  const lastMushaf = lastReading?.mushaf ?? DEFAULT_MUSHAF;
  const lastPage = lastReading ? pageFromRef(lastReading.to_ref) : null;
  const finished = lastPage != null && lastPage >= totalPages(lastMushaf);
  const startPage = lastPage == null ? null : finished ? 1 : lastPage + 1;

  const dateLabel = new Date(now).toLocaleDateString("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  // Same instant on the Islamic calendar; hidden if the runtime lacks it.
  const hijriLabel = hijriDate(now, tz);

  const handlePick = (t: EntryType) => {
    setEditingEntry(null);
    setSheetType(t);
    setSheetOpen(true);
  };

  const handleEdit = (entry: LogRow) => {
    setEditingEntry(entry);
    setSheetType(entry.entry_type);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingEntry(null);
  };

  const failHaptic = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const handleUpdate = async (id: string, payload: NewEntry) => {
    const prev = entries;
    // Edits never change logged_at - drop it so the spread keeps the original.
    const { logged_at: _omit, ...fields } = payload;
    void _omit;
    setEntries((p) =>
      p.map((e) =>
        e.id === id
          ? {
              ...e,
              ...fields,
              pages_equiv: pagesEquiv(payload.amount, payload.unit),
            }
          : e,
      ),
    );
    const { row, error } = await updateEntry(id, payload);
    if (error || !row) {
      setEntries(prev);
      setError(error ?? "Couldn’t save your changes. Try again.");
      failHaptic();
      return;
    }
    setEntries((p) => p.map((e) => (e.id === id ? row : e)));
  };

  const handleSave = async (payload: NewEntry) => {
    if (!groupId || !userId) return;
    setError(null);
    setNotice(null);
    if (editingEntry) {
      await handleUpdate(editingEntry.id, payload);
      return;
    }
    // Celebrate a freshly logged reading (not edits). The sheet is a native
    // Modal that stays mounted for SHEET_CLOSE_MS while it slides out and
    // sits above the whole app, so wait for it to leave before the burst
    // (the web portalled Celebration above the sheet, z-100 over z-50).
    if (isReadingType(payload.entry_type) && celebrateOn.current) {
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => {
        celebrateTimer.current = null;
        setCelebrateTick((t) => t + 1);
      }, SHEET_CLOSE_MS);
    }
    // A backdated entry won't show in today's list - say so.
    const backdated =
      payload.logged_at != null && localDate(payload.logged_at, tz) !== today;
    if (backdated) setNotice("Saved to yesterday.");
    // No crypto.randomUUID on Hermes; the row only needs a unique local id
    // until the insert returns the real one (EntryRow reads the temp- prefix).
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: LogRow = {
      id: tempId,
      user_id: userId,
      group_id: groupId,
      pages_equiv: pagesEquiv(payload.amount, payload.unit),
      ...payload,
      logged_at: payload.logged_at ?? new Date().toISOString(),
    };
    setEntries((prev) => [optimistic, ...prev]);

    const base: Record<string, unknown> = {
      user_id: userId,
      group_id: groupId,
      ...(payload.logged_at ? { logged_at: payload.logged_at } : {}),
      entry_type: payload.entry_type,
      from_ref: payload.from_ref,
      to_ref: payload.to_ref,
      amount: payload.amount,
      unit: payload.unit,
      juz: payload.juz,
      part: payload.part,
      notes: payload.notes,
    };
    let res = await supabase
      .from("log_entries")
      .insert(payload.mushaf != null ? { ...base, mushaf: payload.mushaf } : base)
      .select("*")
      .single();
    // Retry without mushaf if that column isn't in the schema yet.
    if (isMissingMushaf(res.error) && payload.mushaf != null) {
      res = await supabase.from("log_entries").insert(base).select("*").single();
    }
    const { data, error } = res;

    if (error || !data) {
      setEntries((prev) => prev.filter((e) => e.id !== tempId));
      // Don't leave "Saved to yesterday." up next to the failure.
      setNotice(null);
      setError(error?.message ?? "Couldn’t save that entry. Try again.");
      failHaptic();
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === tempId ? (data as LogRow) : e)));
  };

  const handleDelete = async (id: string) => {
    const prev = entries;
    setEntries((p) => p.filter((e) => e.id !== id));
    const error = await deleteEntry(id);
    if (error) {
      setEntries(prev);
      setError(error);
      failHaptic();
    }
  };

  const segments: Segment<Filter>[] = [
    { value: "all", label: "All" },
    {
      value: "new",
      label: mode === "hifz" ? "New (Sabak)" : "Reading",
    },
    {
      value: "revision",
      label: mode === "hifz" ? "Revision" : "Revising",
    },
  ];

  // The web had its data at first paint. Here the header shows at once and
  // the body follows the first fetch (or the "no circle" answer), so the
  // stats never flash 0 and the empty state never flashes before the rows.
  const showBody = membership === null || loadState !== "loading";
  // Nothing ever loaded: the stats and bookmark would be read off missing
  // data (streak 0, no place to resume), so they stay hidden until a retry
  // lands. Anything logged meanwhile still lists below.
  const loadFailed = loadState === "failed";

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.canvas }]}>
      {/* First child on purpose: react-native-screens applies the tab bar
          content inset to the first scroll view in the first-descendant
          chain, so the FAB and Celebration layers come after it. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: LIST_BOTTOM_CLEARANCE }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          groupId ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} />
          ) : undefined
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={styles.headerText}>
              <Text style={[Type.caption, styles.upper, { color: c.faint }]}>{dateLabel}</Text>
              <Text style={[Type.display, styles.title, { color: c.foreground }]}>Today</Text>
              {hijriLabel ? (
                <Text style={[Type.footnote, styles.hijri, { color: c.muted }]}>{hijriLabel}</Text>
              ) : null}
            </View>
            <View style={styles.headerButtons}>
              {/* Every entry and note, all time - Today only shows today's. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Journal"
                onPress={() => router.push("/journal")}
                hitSlop={8}
                style={[styles.headerButton, { backgroundColor: c.surface2 }]}
              >
                <NotebookPen size={20} color={c.muted} />
              </Pressable>
              {/* The web linked Settings through the avatar; native keeps a
                  gear so the Profile tab owns the avatar. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                onPress={() => router.push("/settings")}
                hitSlop={8}
                style={[styles.headerButton, { backgroundColor: c.surface2 }]}
              >
                <SettingsIcon size={20} color={c.muted} />
              </Pressable>
            </View>
          </View>
        </View>

        {showBody && (
          <>
            {/* Stats */}
            {!loadFailed && (
              <View style={styles.statsRow}>
                <Card style={styles.statCard}>
                  <Text style={[Type.footnote, styles.medium, { color: c.muted }]}>Streak</Text>
                  <Text style={[Type.title1, styles.statNumber, { color: c.foreground }]}>{streak}</Text>
                  <Text style={[Type.footnote, { color: c.faint }]}>
                    {streak === 1 ? "day" : "days"} · longest {longest}
                  </Text>
                </Card>
                <Card style={styles.statCard}>
                  <Text style={[Type.footnote, styles.medium, { color: c.muted }]}>Logged today</Text>
                  <Text style={[Type.title1, styles.statNumber, { color: c.foreground }]}>
                    {todayEntries.length}
                  </Text>
                  <Text style={[Type.footnote, { color: c.faint }]}>
                    {todayEntries.length === 1 ? "entry" : "entries"}
                  </Text>
                </Card>
              </View>
            )}

            {/* Resume-from bookmark - shows the next page to start on. */}
            {!loadFailed && startPage != null && (
              <View style={styles.bookmarkWrap}>
                <View style={[styles.bookmark, { backgroundColor: c.accentTint }]}>
                  <Bookmark size={16} color={c.accent} />
                  <Text style={[Type.footnote, styles.medium, styles.bookmarkText, { color: c.accent }]}>
                    {finished ? "Khatm done 🎉 Start again from" : "Start from"} p.{startPage} ·{" "}
                    {bookmarkLabel(lastMushaf, startPage)}
                  </Text>
                </View>
              </View>
            )}

            {/* Filter (hifz only - readers have a single category) */}
            {mode !== "reading" && todayEntries.length > 0 && (
              <View style={styles.filterWrap}>
                <SegmentedControl segments={segments} value={filter} onChange={setFilter} />
              </View>
            )}

            {error && (
              <View style={[styles.banner, { backgroundColor: c.dangerTint }]}>
                <Text style={[Type.footnote, { color: c.danger }]}>{error}</Text>
              </View>
            )}

            {/* Backdated entries don't appear in today's list - confirm the save. */}
            {notice && (
              <View style={[styles.banner, { backgroundColor: c.accentTint }]}>
                <Text style={[Type.footnote, { color: c.accent }]}>{notice}</Text>
              </View>
            )}

            {/* Entries */}
            <View style={styles.entries}>
              {/* One-time reminders for later today - the section is also the
                  reminder door for single-type modes, whose FAB never fans out.
                  Mounted only once the first fetch has landed (see dayReminders). */}
              {groupId && userId && dayReminders && (
                <DayReminders
                  ref={remindersRef}
                  userId={userId}
                  tz={tz}
                  mode={mode}
                  initial={dayReminders}
                  entries={entries}
                />
              )}
              {!groupId ? (
                <EmptyState
                  icon={UserPlus}
                  title="You’re not in a circle yet"
                  note="Ask the group owner to add you. Once you’re in, your logs and your circle’s feed show up here."
                />
              ) : loadFailed && todayEntries.length === 0 ? (
                <EmptyState
                  icon={WifiOff}
                  title="Couldn’t load today"
                  note="Check your connection and pull down to retry."
                />
              ) : todayEntries.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="Nothing logged yet today"
                  note="Tap the + to log your first entry. Small and consistent wins."
                />
              ) : (
                <>
                  <Text style={[Type.caption, styles.upper, styles.sectionLabel, { color: c.faint }]}>
                    Today’s entries
                  </Text>
                  {filtered.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      tz={tz}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <Text style={[Type.footnote, styles.noneLabel, { color: c.faint }]}>
                      No {filter} entries today.
                    </Text>
                  )}
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <SpeedDial
        mode={mode}
        onPick={handlePick}
        // DayReminders (and so remindersRef) mounts only once the first fetch
        // has landed; without it the fan-out shows just the entry types
        // instead of a "Remind me" pill that would close the dial and open
        // nothing (a failed first load leaves the FAB usable for logging).
        onReminder={dayReminders ? () => remindersRef.current?.open() : undefined}
        // Solid together with the body: a tap during the first fetch would
        // open a sheet without the hifz continuation (see pendingLog).
        disabled={!groupId || loadState === "loading"}
        bottomOffset={fabBottomOffset(insets.bottom)}
      />

      <LogSheet
        open={sheetOpen}
        onClose={closeSheet}
        initialType={sheetType}
        onSave={handleSave}
        editing={editingEntry}
        lastReadPage={lastPage}
        lastOfType={editingEntry ? null : lastOfType}
        mushaf={mushaf}
        tz={tz}
      />

      <Celebration trigger={celebrateTick} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // No elevation here: the SpeedDial scrim is a sibling and must stay above.
  scroll: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  headerText: { flex: 1 },
  upper: { textTransform: "uppercase", letterSpacing: 0.65 },
  title: { marginTop: 4 },
  hijri: { marginTop: 2 },
  headerButtons: { flexDirection: "row", gap: 10, marginLeft: 12 },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: { flexDirection: "row", gap: 12, paddingHorizontal: 20 },
  statCard: { flex: 1 },
  medium: { fontWeight: "500" },
  statNumber: { marginTop: 8, fontVariant: ["tabular-nums"] },
  bookmarkWrap: { paddingHorizontal: 20, paddingTop: 12 },
  bookmark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bookmarkText: { flex: 1 },
  filterWrap: { paddingHorizontal: 20, paddingTop: 20 },
  banner: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  entries: { marginTop: 16, paddingHorizontal: 20, gap: 10 },
  sectionLabel: { paddingHorizontal: 4 },
  noneLabel: { paddingHorizontal: 4, paddingTop: 8 },
});
