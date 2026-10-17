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
  Keyboard,
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
  insertEntry,
  markEntriesChanged,
  takeEntriesChanged,
  updateEntry,
} from "@/data/entryWrites";
import { fetchMyDayReminders, fetchMyRecentEntries } from "@/data/entryReads";
import { useMembership } from "@/hooks/use-membership";
import { useNow } from "@/hooks/use-now";
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
import { parseLogAmount } from "@/lib/entryDefaults";
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

/** Clearance above the tab bar so the FAB never covers the last row (web:
 *  pb-28). The FAB is about 56 tall and sits 20 above the tab bar, so its top
 *  edge is 76 above it; 112 leaves a 36 gap over that, enough for the last
 *  row's action buttons (Edit, Delete) to stay tappable. */
const LIST_BOTTOM_CLEARANCE = 112;

/** Space under the last row. On iOS the liquid-glass tab bar floats over the
 *  tab screen and nothing insets the scroll view for it, and insets.bottom
 *  there is the tab bar plus the home indicator (the tab screen has its own
 *  SafeAreaProvider; the FAB is positioned from the same value in
 *  fabBottomOffset), so it is added to the clearance that sits above the bar.
 *  On Android expo-router wraps the tab screen in a SafeAreaView whose bottom
 *  edge already ends above the bar, so adding it again would leave a blank
 *  band. */
function listBottomClearance(insetBottom: number): number {
  return Platform.OS === "ios" ? LIST_BOTTOM_CLEARANCE + insetBottom : LIST_BOTTOM_CLEARANCE;
}

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
  const params = useLocalSearchParams<{ log?: string; r?: string; amount?: string }>();

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
  // A notification action ("Log 5 pages") adds &amount=<n>: the sheet opens
  // with the pages prefilled so Save is the only tap left (docs/PHASE3.md).
  const openAmount = openLog ? parseLogAmount(oneParam(params.amount)) : null;

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
  const linkId = openLog ? `${openLog}|${openLogKey ?? ""}|${openAmount ?? ""}` : null;
  const [seenLink, setSeenLink] = useState<string | null>(null);
  const [pendingLog, setPendingLog] = useState<EntryType | null>(null);
  // Pages the link asked to prefill; the sheet reads it once per open.
  const [sheetPreset, setSheetPreset] = useState<number | null>(null);
  if (linkId !== seenLink) {
    setSeenLink(linkId);
    if (openLog && !deepLinkConsumed(openLogKey)) {
      setPendingLog(openLog);
      setSheetPreset(openAmount);
    }
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
    router.setParams({ log: undefined, r: undefined, amount: undefined });
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
  // never landed gets another go on return. So does a list the Android
  // notification task changed while the app was in the background (it
  // leaves the same flag the Journal does, and a return to the foreground
  // is not a focus): logging from the sheet must continue from the new row.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (loadStateRef.current === "failed" || takeEntriesChanged()) void loadToday();
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

  // Confetti-on-reading preference (device-local; toggled in Settings on the Profile tab).
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
  const streak = currentStreak(loggedDays, tz, now);
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
    setSheetPreset(null);
    setSheetType(t);
    setSheetOpen(true);
  };

  const handleEdit = (entry: LogRow) => {
    setEditingEntry(entry);
    setSheetPreset(null);
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
    // LogSheet calls onClose right after onSave. Dismiss the keyboard first,
    // synchronously, so its slide-out runs together with the sheet's close
    // instead of after it; the confetti timer below waits SHEET_CLOSE_MS and
    // would otherwise start while the keyboard is still on its way down.
    Keyboard.dismiss();
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

    const { row: data, error } = await insertEntry(userId, groupId, payload);

    if (error || !data) {
      setEntries((prev) => prev.filter((e) => e.id !== tempId));
      // Don't leave "Saved to yesterday." up next to the failure.
      setNotice(null);
      setError(error ?? "Couldn’t save that entry. Try again.");
      failHaptic();
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === tempId ? data : e)));
  };

  const handleDelete = async (id: string) => {
    setEntries((p) => p.filter((e) => e.id !== id));
    const error = await deleteEntry(id);
    if (error) {
      // An error does not mean the row survived: the request can fail after
      // the server committed (the simulator check saw a deleted row come back
      // with this message). Restoring a snapshot would also undo anything
      // that changed meanwhile, so re-read the list instead; the row returns
      // only if it is really still there.
      setError(error);
      failHaptic();
      void loadToday();
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
      {/* First child on purpose: the FAB, sheet and Celebration layers come
          after it so they paint above the list. The root pads insets.top
          itself (no automatic top inset on the tab screen), which also keeps
          the pull-to-refresh spinner below the status bar. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: listBottomClearance(insets.bottom) }}
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
                  gear that jumps to the Settings block on the Profile tab. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Settings"
                onPress={() => router.push("/profile?section=settings")}
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
        presetAmount={editingEntry ? null : sheetPreset}
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
