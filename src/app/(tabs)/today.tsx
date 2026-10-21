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
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  AppState,
  Keyboard,
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
import { RevisionCard } from "@/components/RevisionCard";
import { SpeedDial } from "@/components/SpeedDial";
import { SyncIssues } from "@/components/SyncIssues";
import { Card, SegmentedControl, type Segment } from "@/components/ui";
import { CLOSE_MS as SHEET_CLOSE } from "@/components/ui/Sheet";
import { Radius, Type } from "@/constants/theme";
import {
  deleteEntry,
  markEntriesChanged,
  NEEDS_CONNECTION,
  takeEntriesChanged,
  updateEntry,
} from "@/data/entryWrites";
import { onRemoved, onSynced, syncOutbox } from "@/data/sync";
import {
  fetchMyDayReminders,
  fetchMyHifzHistory,
  fetchMyRecentEntries,
  type HifzHistoryRow,
} from "@/data/entryReads";
import { useMembership } from "@/hooks/use-membership";
import { useOutbox } from "@/hooks/use-outbox";
import { useNow } from "@/hooks/use-now";
import { useReselectScrollToTop } from "@/hooks/use-reselect-scroll-to-top";
import { useTabBarClearance } from "@/hooks/use-tab-bar-clearance";
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
import { redatedToNow, withPending, type OutboxItem } from "@/lib/outbox";
import {
  bookmarkLabel,
  DEFAULT_MUSHAF,
  pageFromRef,
  totalPages,
  type MushafId,
} from "@/lib/mushaf";
import {
  dueToday,
  mergeRevisionEntries,
  revisionPlan,
  type RevisionItem,
} from "@/lib/revisionPlan";
import type { DayReminder, LogRow, NewEntry } from "@/lib/types";
import { uuidv4 } from "@/lib/uuid";
import { useSession } from "@/providers/SessionProvider";
import { useRevisionNudges } from "@/push/useRevisionNudges";
import { readCache, writeCache } from "@/storage/cache";
import { discardQueued, enqueue, outboxSnapshot, updateQueued } from "@/storage/outbox";
import {
  PREF_KEYS,
  readPref,
  readRevisionHidden,
  writeRevisionHidden,
} from "@/storage/prefs";

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

/** Space under the last row: LIST_BOTTOM_CLEARANCE above the tab bar. The
 *  bar floats over the tab screen on both platforms (iOS: the system Liquid
 *  Glass bar; Android: our glass bar) and nothing insets the scroll view for
 *  it, so the bar clearance (useTabBarClearance) is added on top. */
function listBottomClearance(barClearance: number): number {
  return LIST_BOTTOM_CLEARANCE + barClearance;
}

/** Web: the FAB sits bottom-5 (20) from the page. Here it sits 20 above the
 *  floating tab bar; it is absolutely positioned, so no scroll-view inset
 *  helps it and it takes the bar clearance directly. */
function fabBottomOffset(barClearance: number): number {
  return barClearance + 20;
}

/** How long the LogSheet's Modal stays mounted while it slides out. */
const SHEET_CLOSE_MS = SHEET_CLOSE;

/** First load of entries + reminders: not started, landed (from the server
 *  or from the copy saved last time), or failed with nothing saved. Once
 *  "ready" it stays ready; later refreshes that fail keep the list and say
 *  it is the saved copy instead. */
type LoadState = "loading" | "ready" | "failed";

/** Add rows the outbox just sent (or replace an older copy of them). */
function upsertRows(prev: LogRow[], rows: LogRow[]): LogRow[] {
  const ids = new Set(rows.map((r) => r.id));
  return [...rows, ...prev.filter((r) => !ids.has(r.id))];
}

/** How long a sent row is laid over server reads that may predate it. */
const SYNCED_KEEP_MS = 2 * 60 * 1000;

/** How long a deep link waits on the saved copy for the server's answer. */
const SEED_WAIT_MS = 4000;

/** A read still out after this long, with the saved copy on screen, reads
 *  as offline. */
const SLOW_READ_MS = 10_000;

/** While the saved copy is on screen, how often Today tries the server
 *  again, so "Offline" clears by itself once the connection is back (the
 *  read that lands also sends what waits). */
const OFFLINE_RETRY_MS = 30_000;

function entriesWord(n: number): string {
  return n === 1 ? "1 entry" : `${n} entries`;
}

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
  const barClearance = useTabBarClearance();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useReselectScrollToTop(scrollRef);
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

  // The server's rows (or the saved copy of them). What the screen shows is
  // `entries` below: these plus the outbox's entries still waiting to send.
  const [serverEntries, setEntries] = useState<LogRow[]>([]);
  // null until the first fetch lands: DayReminders owns its rows after
  // mount (useState(initial), as on the web), so it is mounted only once the
  // real list is here instead of being seeded with [] and ignoring the rest.
  // Later values are ignored by design (the section refetches on its own,
  // including on a timezone change), so it is set exactly once.
  const [dayReminders, setDayReminders] = useState<DayReminder[] | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // The last read failed and the screen shows the saved copy (docs/NEXT-SESSION.md
  // "Cached reads"). Cleared by the next read or send that lands.
  const [offline, setOffline] = useState(false);
  // The member's whole hifz history for the revision plan (the 120-day
  // entries would let an old juz drop out), with the instant below which it
  // is used instead of `entries` (see mergeRevisionEntries). null until a
  // read has landed; a later failed read keeps the last good one.
  const [hifzHistory, setHifzHistory] = useState<{
    rows: HifzHistoryRow[];
    cutoff: string;
  } | null>(null);
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
  // The first server read has landed or failed (or the saved copy has
  // waited SEED_WAIT_MS for it): rows a deep-linked sheet may continue from.
  const [firstReadSettled, setFirstReadSettled] = useState(false);
  // Pages the link asked to prefill; the sheet reads it once per open.
  const [sheetPreset, setSheetPreset] = useState<number | null>(null);
  // The juz a revision-card row asked to prefill (null = the sheet's usual
  // carry-on juz); read once per open like sheetPreset.
  const [sheetJuz, setSheetJuz] = useState<number | null>(null);
  if (linkId !== seenLink) {
    setSeenLink(linkId);
    if (openLog && !deepLinkConsumed(openLogKey)) {
      setPendingLog(openLog);
      setSheetPreset(openAmount);
    }
  }
  // Release only once the server has answered (or given up, or a saved copy
  // has been on screen a few seconds while offline): the LogSheet freezes
  // lastOfType at mount (its form key excludes it on purpose), so opening
  // on rows that are about to change would lose the hifz continuation the
  // web always had at first paint.
  if (pendingLog && (membership === null || firstReadSettled)) {
    setPendingLog(null);
    // Not in a circle: nothing can be logged, drop the intent (web: the
    // initializer required groupId too).
    if (membership) {
      setEditingEntry(null);
      setSheetJuz(null);
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
  // Set once a server read has landed: the saved copy must never paint over
  // fresher rows, and is only read for the first load.
  const landed = useRef(false);
  const seeded = useRef(false);
  // The saved copy is on screen (set with it, ahead of the loadState ref),
  // and whether the last server read failed (it can fail first).
  const seededReady = useRef(false);
  const lastReadFailed = useRef(false);
  // DayReminders reads `initial` once. When it was mounted with the saved
  // copy, the server's first answer remounts it (new key) with fresh rows.
  const remindersSeeded = useRef(false);
  const [remindersKey, setRemindersKey] = useState("saved");
  // Rows the outbox sent lately. A read that started before one landed can
  // answer after it without it; such rows are added back (never replacing
  // the server's copy, which may hold a later edit). A read that started
  // after it landed and lacks it means it was deleted (the Journal, the
  // web), so only rows newer than the read's start come back.
  const recentlySynced = useRef(new Map<string, { row: LogRow; at: number }>());
  // Edits on screen that the server has not confirmed: the saved copy is
  // not written meanwhile (a kill would leave an edit that never landed).
  const editsInFlight = useRef(0);

  // The web page did this on the server: recent entries and today's +
  // tomorrow's one-time reminders in one go, once the circle is known. Here
  // it is also the retry for every surface below (focus, pull-to-refresh,
  // foreground return), so a failed first fetch does not stick for the
  // session: the shared helpers never reject, so the error must be read.
  const loadToday = useCallback((): Promise<void> => {
    if (!groupId || !userId) return Promise.resolve();
    const seq = ++loadSeq.current;
    const startedAt = Date.now();
    // Offline the reads can take half a minute to fail: show what was saved
    // last time at once, then let the server's answer replace it.
    if (!seeded.current) {
      seeded.current = true;
      void Promise.all([readCache("today", userId), readCache("hifz", userId)]).then(
        ([saved, savedHifz]) => {
          if (landed.current) return;
          if (savedHifz) setHifzHistory(savedHifz);
          if (!saved) return;
          seededReady.current = true;
          remindersSeeded.current = true;
          setEntries(saved.entries);
          setDayReminders((cur) => cur ?? saved.reminders);
          setLoadState("ready");
          if (lastReadFailed.current) setOffline(true);
          // Offline the server may take half a minute to give up; a deep
          // link should not wait that long on a usable saved copy.
          setTimeout(() => setFirstReadSettled(true), SEED_WAIT_MS);
        },
      );
    }
    // A day inside the 120-day window: newer rows come from `entries`.
    const cutoff = new Date(Date.now() - 119 * 24 * 60 * 60 * 1000).toISOString();
    // Offline with an expired token the reads take half a minute to fail
    // (supabase-js retries the refresh first). With the saved copy on screen,
    // say "Offline" after a while; an answer that lands clears it.
    const slow = setTimeout(() => {
      if (seq === loadSeq.current && seededReady.current && !landed.current) setOffline(true);
    }, SLOW_READ_MS);
    return Promise.all([
      fetchMyRecentEntries(groupId, userId),
      fetchMyDayReminders(userId, todayLocal(tz), tomorrowLocal(tz)),
      fetchMyHifzHistory(userId),
    ]).then(([recent, reminders, history]) => {
      clearTimeout(slow);
      if (seq !== loadSeq.current) return;
      // Its own failure never fails the load: the card falls back to the
      // window and the nudges stay as scheduled (see `plan` below).
      if (!history.error && history.rows) {
        const rows = history.rows;
        setHifzHistory({ rows, cutoff });
        void writeCache("hifz", userId, { rows, cutoff });
      }
      setFirstReadSettled(true);
      if (recent.error || !recent.rows || reminders.error || !reminders.rows) {
        lastReadFailed.current = true;
        if (loadStateRef.current === "ready" || seededReady.current) {
          // The list on screen is still good; say it is the saved copy and
          // let the next focus try again (the web guarded this refetch with
          // `data &&`).
          markEntriesChanged();
          setOffline(true);
        } else {
          setLoadState("failed");
        }
        return;
      }
      landed.current = true;
      lastReadFailed.current = false;
      const rows = reminders.rows;
      const cutoffMs = Date.now() - SYNCED_KEEP_MS;
      const missing: LogRow[] = [];
      const have = new Set(recent.rows.map((r) => r.id));
      for (const [id, v] of recentlySynced.current) {
        if (v.at < cutoffMs) recentlySynced.current.delete(id);
        else if (v.at >= startedAt && !have.has(id)) missing.push(v.row);
      }
      setEntries(missing.length ? [...missing, ...recent.rows] : recent.rows);
      if (remindersSeeded.current) {
        remindersSeeded.current = false;
        setDayReminders(rows);
        setRemindersKey("server");
      } else {
        setDayReminders((cur) => cur ?? rows);
      }
      setLoadState("ready");
      setOffline(false);
      setError((e) => (e === NEEDS_CONNECTION ? null : e));
      // A read that landed means the connection is back: send what waits.
      void syncOutbox(userId);
    });
  }, [
    groupId,
    userId,
    tz,
    setEntries,
    setDayReminders,
    setLoadState,
    setOffline,
    setHifzHistory,
    setFirstReadSettled,
    setError,
  ]);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  // Offline: try again now and then while the app is on screen. Nothing
  // else re-reads when no entry waits to send (Android emulator test: the
  // line stayed up after reconnecting until a pull to refresh).
  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void loadToday();
    }, OFFLINE_RETRY_MS);
    return () => clearInterval(timer);
  }, [offline, loadToday]);

  // The saved copy follows the list (a read, a sent entry, an edit), so an
  // offline launch or a notification button continues from the latest rows
  // this phone knows. Never before something real is on screen.
  useEffect(() => {
    if (!userId || loadState !== "ready" || editsInFlight.current > 0) return;
    void writeCache("today", userId, { entries: serverEntries, reminders: dayReminders ?? [] });
  }, [userId, loadState, serverEntries, dayReminders]);

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
      await Promise.all([loadToday(), userId ? syncOutbox(userId) : null]);
    } finally {
      setRefreshing(false);
    }
  }, [loadToday, userId]);

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

  // The offline outbox (docs/NEXT-SESSION.md "Offline logging"): every new
  // entry is queued with its own id and sent from there. Waiting entries
  // join the list, the streak, "continue from" and the revision plan at
  // once; refused ones are listed apart (SyncIssues) and count for nothing.
  const outbox = useOutbox(userId);
  const queued = useMemo(
    () => outbox.items.filter((i) => i.groupId === groupId),
    [outbox.items, groupId],
  );
  const entries = useMemo(() => withPending(serverEntries, queued), [serverEntries, queued]);
  const queuedById = useMemo(() => new Map(queued.map((i) => [i.id, i])), [queued]);
  const refused = queued.filter((i) => i.state === "rejected");
  // Logged offline and not sent yet (a first send still in flight is just
  // "saving", not waiting).
  // Once a send has failed, a retry in flight still reads as waiting (the
  // emulator test saw rows flicker to "saving" on every backoff tick).
  const waitingCount = queued.filter(
    (i) => i.state === "pending" && !i.discard && i.attempts > 0,
  ).length;
  const syncMark = (id: string): "saving" | "waiting" | undefined => {
    const item = queuedById.get(id);
    if (!item) return undefined;
    return item.attempts === 0 ? "saving" : "waiting";
  };

  // A sent entry joins the server rows before it leaves the queue, so it
  // never blinks out of the list in between.
  useEffect(() => {
    if (!userId) return;
    return onSynced((uid, rows) => {
      if (uid !== userId) return;
      const at = Date.now();
      for (const row of rows) recentlySynced.current.set(row.id, { row, at });
      setEntries((prev) => upsertRows(prev, rows));
      setOffline(false);
    });
  }, [userId]);

  // A discarded entry deleted on the server leaves the list for good.
  useEffect(() => {
    if (!userId) return;
    return onRemoved((uid, id) => {
      if (uid !== userId) return;
      recentlySynced.current.delete(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    });
  }, [userId]);

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
  // Opened from a revision-card row, it is the newest of the type in that
  // juz, so the portion and start page carry on within the juz being
  // revised (none there: the sheet starts the juz fresh, see presetJuz).
  const lastOfType = useMemo(() => {
    let best: LogRow | null = null;
    for (const x of entries) {
      if (x.entry_type !== sheetType) continue;
      if (sheetJuz != null && x.juz !== sheetJuz) continue;
      if (!best || new Date(x.logged_at) > new Date(best.logged_at)) best = x;
    }
    return best;
  }, [entries, sheetType, sheetJuz]);
  const lastMushaf = lastReading?.mushaf ?? DEFAULT_MUSHAF;
  const lastPage = lastReading ? pageFromRef(lastReading.to_ref) : null;
  const finished = lastPage != null && lastPage >= totalPages(lastMushaf);
  const startPage = lastPage == null ? null : finished ? 1 : lastPage + 1;

  // Revision plan (hifz; docs/DECISIONS.md "Revision plan"): the whole hifz
  // history, with the live entries on top so a log, edit or delete counts at
  // once. Without the history (its read failed) the card still works from
  // the 120-day window, where a juz untouched that long would drop out, so
  // the nudges are then left as scheduled instead of rebuilt from it.
  const plan = useMemo(() => {
    if (mode !== "hifz") return [];
    const input = hifzHistory
      ? mergeRevisionEntries(entries, hifzHistory.rows, hifzHistory.cutoff)
      : entries;
    return revisionPlan(input, tz, today);
  }, [mode, entries, hifzHistory, tz, today]);
  // Rows hidden for today, per member and local date; null until the pref
  // has been read for this member and day, so a hidden row never flashes
  // back and the nudges never schedule it for tonight.
  const [hidden, setHidden] = useState<{ userId: string; date: string; juz: number[] } | null>(
    null,
  );
  useEffect(() => {
    if (!userId) return;
    let active = true;
    readRevisionHidden(userId, today).then((juz) => {
      if (active) setHidden({ userId, date: today, juz });
    });
    return () => {
      active = false;
    };
  }, [userId, today]);
  const hiddenToday =
    hidden && hidden.userId === userId && hidden.date === today ? hidden.juz : null;
  const revisionRows = hiddenToday
    ? dueToday(plan).filter((i) => !hiddenToday.includes(i.juz))
    : [];

  // The evening nudges follow the same plan. Not before the first fetch has
  // landed (an empty list then would cancel tonight's nudge for nothing), and
  // not from the window alone (it can miss an old juz).
  useRevisionNudges({
    userId,
    hifz: mode === "hifz",
    plan: profile && loadState === "ready" && (mode !== "hifz" || hifzHistory) ? plan : null,
    today,
    hiddenToday,
  });

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
    setSheetJuz(null);
    setSheetType(t);
    setSheetOpen(true);
  };

  const handleEdit = (entry: LogRow) => {
    setEditingEntry(entry);
    setSheetPreset(null);
    setSheetJuz(null);
    setSheetType(entry.entry_type);
    setSheetOpen(true);
  };

  // A revision-card row: that row's type, with its juz preselected.
  const handleRevise = (item: RevisionItem) => {
    setEditingEntry(null);
    setSheetPreset(null);
    setSheetJuz(item.juz);
    setSheetType(item.type);
    setSheetOpen(true);
  };

  const handleHideRevision = (juz: number) => {
    if (!userId || !hiddenToday) return;
    const next = [...hiddenToday, juz];
    setHidden({ userId, date: today, juz: next });
    void writeRevisionHidden(userId, today, next);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingEntry(null);
  };

  const failHaptic = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const handleUpdate = async (id: string, payload: NewEntry) => {
    // Edits never change logged_at - drop it so the spread keeps the original.
    const { logged_at: _omit, ...fields } = payload;
    void _omit;
    // Still in the outbox: the edit stays on the device and goes up with the
    // entry. Null means it was sent meanwhile; edit the server row then.
    if (userId && queuedById.has(id)) {
      const edited = await updateQueued(userId, id, (item) => ({
        ...item,
        entry: { ...item.entry, ...fields },
      }));
      if (edited) {
        void syncOutbox(userId);
        return;
      }
    }
    const original = serverEntries.find((e) => e.id === id);
    editsInFlight.current += 1;
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
    const { row, error } = await updateEntry(id, payload).finally(() => {
      editsInFlight.current -= 1;
    });
    if (error || !row) {
      // Put back only this row: others may have changed meanwhile.
      if (original) setEntries((p) => p.map((e) => (e.id === id ? original : e)));
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
    // Queued first, with its own id, then sent: online it leaves the queue
    // within a moment; offline it waits there, marked, and is sent once
    // when the connection is back (a retry hits the same primary key).
    // Dated now on the device, so an entry saved offline at 23:50 stays on
    // its day however late it is sent.
    const savedAt = new Date().toISOString();
    const item: OutboxItem = {
      id: uuidv4(),
      userId,
      groupId,
      entry: { ...payload, logged_at: payload.logged_at ?? savedAt },
      savedAt,
      attempts: 0,
      state: "pending",
    };
    await enqueue(item);
    await syncOutbox(userId);
    // Refused outright: it moves to the "Couldn't sync" card.
    const left = outboxSnapshot(userId).items.find((i) => i.id === item.id);
    if (left?.state === "rejected") failHaptic();
  };

  const handleDelete = async (id: string) => {
    // Still in the outbox: dropping it is all there is to do. False means it
    // was sent meanwhile (and has joined the server rows); delete that.
    recentlySynced.current.delete(id);
    if (userId && queuedById.has(id) && (await discardQueued(userId, id))) return;
    const original = serverEntries.find((e) => e.id === id);
    setEntries((p) => p.filter((e) => e.id !== id));
    const error = await deleteEntry(id);
    if (error === NEEDS_CONNECTION) {
      // No answer at all: offline the request never left, so the row is
      // still there. Put it back now rather than wait for a read that
      // cannot land (it would stay hidden yet keep counting for "Start
      // from"). The next read corrects the rare lost-reply case.
      if (original) setEntries((p) => (p.some((e) => e.id === id) ? p : [original, ...p]));
      setError(error);
      failHaptic();
      markEntriesChanged();
      return;
    }
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

  // A refused entry (SyncIssues): yesterday's window had closed, so log it
  // for today instead; anything else, send it again. Or let it go.
  const handleLogToday = (item: OutboxItem) => {
    if (!userId) return;
    void updateQueued(userId, item.id, (cur) => redatedToNow(cur, new Date().toISOString())).then(
      () => syncOutbox(userId),
    );
  };
  const handleRetry = (item: OutboxItem) => {
    if (!userId) return;
    void updateQueued(userId, item.id, (cur) => ({
      ...cur,
      state: "pending",
      reason: undefined,
      message: undefined,
    })).then(() => syncOutbox(userId));
  };
  const handleDiscard = (item: OutboxItem) => {
    if (!userId) return;
    void discardQueued(userId, item.id);
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
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: listBottomClearance(barClearance) }}
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
            {/* Offline: the saved copy is on screen, and what was logged
                since waits to sync. Quiet on purpose; nothing is wrong. */}
            {(offline || waitingCount > 0) && (
              <View style={styles.statusLine}>
                <WifiOff size={14} color={c.faint} />
                <Text style={[Type.footnote, styles.statusText, { color: c.muted }]}>
                  {[
                    offline ? "Offline, showing saved data." : null,
                    waitingCount > 0
                      ? `${entriesWord(waitingCount)} waiting to sync.`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </Text>
              </View>
            )}

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

            {/* Resume-from bookmark - shows the next page to start on, and
                the page it follows, so neither reads as the other. */}
            {!loadFailed && startPage != null && (
              <View style={styles.bookmarkWrap}>
                <View style={[styles.bookmark, { backgroundColor: c.accentTint }]}>
                  <Bookmark size={16} color={c.accent} />
                  <View style={styles.bookmarkText}>
                    <Text style={[Type.footnote, styles.medium, { color: c.accent }]}>
                      {finished ? "Khatm done 🎉 Start again from" : "Start from"} p.{startPage} ·{" "}
                      {bookmarkLabel(lastMushaf, startPage)}
                    </Text>
                    <Text style={[Type.footnote, { color: c.muted }]}>
                      You read to the end of p.{lastPage}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* What to revise today (hifz only). Hidden or revised rows drop
                out; nothing due means no card at all. */}
            {!loadFailed && groupId && mode === "hifz" && revisionRows.length > 0 && (
              <View style={styles.revisionWrap}>
                <RevisionCard
                  items={revisionRows}
                  onOpen={handleRevise}
                  onHide={handleHideRevision}
                />
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

            {/* Entries the server refused, whatever day they were for. */}
            {refused.length > 0 && (
              <View style={styles.syncIssuesWrap}>
                <SyncIssues
                  items={refused}
                  tz={tz}
                  onLogToday={handleLogToday}
                  onRetry={handleRetry}
                  onDiscard={handleDiscard}
                />
              </View>
            )}

            {/* Entries */}
            <View style={styles.entries}>
              {/* One-time reminders for later today - the section is also the
                  reminder door for single-type modes, whose FAB never fans out.
                  Mounted only once the first fetch has landed (see dayReminders). */}
              {groupId && userId && dayReminders && (
                <DayReminders
                  key={remindersKey}
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
                      sync={syncMark(e.id)}
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
        bottomOffset={fabBottomOffset(barClearance)}
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
        presetJuz={editingEntry ? null : sheetJuz}
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
  revisionWrap: { paddingHorizontal: 20, paddingTop: 12 },
  filterWrap: { paddingHorizontal: 20, paddingTop: 20 },
  banner: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  entries: { marginTop: 16, paddingHorizontal: 20, gap: 10 },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  statusText: { flex: 1 },
  syncIssuesWrap: { paddingHorizontal: 20, paddingTop: 12 },
  sectionLabel: { paddingHorizontal: 4 },
  noneLabel: { paddingHorizontal: 4, paddingTop: 8 },
});
