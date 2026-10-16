"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Inbox, UserPlus, Bookmark, NotebookPen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  deleteEntry,
  isMissingMushaf,
  takeEntriesChanged,
  updateEntry,
} from "@/lib/entryWrites";
import {
  bucketOf,
  isReadingType,
  pagesEquiv,
  type EntryType,
  type Mode,
} from "@/lib/entries";
import {
  bookmarkLabel,
  pageFromRef,
  totalPages,
  DEFAULT_MUSHAF,
  type MushafId,
} from "@/lib/mushaf";
import type { DayReminder, LogRow, NewEntry } from "@/lib/types";
import {
  localDate,
  todayLocal,
  currentStreak,
  longestStreak,
  hijriDate,
} from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { SpeedDial } from "@/components/SpeedDial";
import { LogSheet } from "@/components/LogSheet";
import { EntryRow } from "@/components/EntryRow";
import { DayReminders, type DayRemindersHandle } from "@/components/DayReminders";
import { Celebration, CELEBRATE_KEY } from "@/components/Celebration";

type Filter = "all" | "new" | "revision";

/** Session memory of reminder deep links already acted on, so the sheet
 *  opens once per notification tap and never again from Back or a reload.
 *  Keyed by reminder id; a link without one (typed by hand) always opens. */
const CONSUMED_KEY = "iqra:log-link-consumed";

function deepLinkConsumed(key: string | null): boolean {
  if (!key || typeof window === "undefined") return false;
  try {
    return (sessionStorage.getItem(CONSUMED_KEY) ?? "").split(",").includes(key);
  } catch {
    return false;
  }
}

function markDeepLinkConsumed(key: string | null): void {
  if (!key) return;
  try {
    const seen = (sessionStorage.getItem(CONSUMED_KEY) ?? "")
      .split(",")
      .filter(Boolean);
    if (!seen.includes(key)) {
      sessionStorage.setItem(CONSUMED_KEY, [...seen.slice(-19), key].join(","));
    }
  } catch {
    // Private mode or storage blocked: the URL strip still covers reloads.
  }
}

export function TodayClient({
  mode,
  tz,
  displayName,
  avatarUrl,
  userId,
  groupId,
  initialEntries,
  initialDayReminders,
  serverNow,
  openLog,
  openLogKey,
  mushaf,
}: {
  mode: Mode;
  tz: string;
  displayName: string;
  avatarUrl: string | null;
  userId: string;
  groupId: string | null;
  initialEntries: LogRow[];
  initialDayReminders: DayReminder[];
  /** Server clock at render (hydration-safe seed for the reminders list). */
  serverNow: number;
  /** Entry type to open the log sheet on straight away (reminder deep link). */
  openLog: EntryType | null;
  /** The reminder behind that deep link; opened once per session, so Back
   *  or a cached payload can't pop the sheet up again. */
  openLogKey: string | null;
  mushaf: MushafId;
}) {
  const [entries, setEntries] = useState<LogRow[]>(initialEntries);
  const [filter, setFilter] = useState<Filter>("all");
  // A deep link opens the sheet from the first render. Safe: Sheet renders
  // nothing until mounted, so server and client HTML agree either way.
  const [sheetOpen, setSheetOpen] = useState(
    () => openLog != null && !!groupId && !deepLinkConsumed(openLogKey),
  );
  const [sheetType, setSheetType] = useState<EntryType>(
    openLog ?? (mode === "hifz" ? "sabak" : "reading"),
  );
  const [editingEntry, setEditingEntry] = useState<LogRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const remindersRef = useRef<DayRemindersHandle>(null);

  // Consume the deep link: remember it, then drop the query from the URL.
  // The strip is deferred a tick so it reaches Next's patched replaceState
  // (the router installs it in a parent effect, which runs after ours) and
  // the history entry keeps the router state Back needs. router.replace
  // would also work but re-runs the page's server queries for nothing.
  useEffect(() => {
    if (!openLog) return;
    markDeepLinkConsumed(openLogKey);
    const t = setTimeout(() => {
      if (window.location.search) {
        window.history.replaceState(null, "", "/today");
      }
    }, 0);
    return () => clearTimeout(t);
  }, [openLog, openLogKey]);

  // Back from the Journal after it edited or deleted entries: the router may
  // have restored this page with its old list, so fetch a fresh one.
  useEffect(() => {
    if (!groupId || !takeEntriesChanged()) return;
    let cancelled = false;
    const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    createClient()
      .from("log_entries")
      .select("*")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .gte("logged_at", since)
      .order("logged_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled && data) setEntries(data as LogRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, userId]);

  // Confetti-on-reading preference (device-local; toggled in Settings).
  const [celebrateTick, setCelebrateTick] = useState(0);
  const celebrateOn = useRef(true);
  useEffect(() => {
    celebrateOn.current = localStorage.getItem(CELEBRATE_KEY) !== "0";
  }, []);

  const today = todayLocal(tz);

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

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  // Same instant on the Islamic calendar; hidden if the runtime lacks it.
  const hijriLabel = hijriDate(new Date(), tz);

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
      return;
    }
    setEntries((p) => p.map((e) => (e.id === id ? row : e)));
  };

  const handleSave = async (payload: NewEntry) => {
    if (!groupId) return;
    setError(null);
    setNotice(null);
    if (editingEntry) {
      await handleUpdate(editingEntry.id, payload);
      return;
    }
    // Celebrate a freshly logged reading (not edits).
    if (isReadingType(payload.entry_type) && celebrateOn.current) {
      setCelebrateTick((t) => t + 1);
    }
    // A backdated entry won't show in today's list - say so.
    const backdated =
      payload.logged_at != null &&
      localDate(payload.logged_at, tz) !== today;
    if (backdated) setNotice("Saved to yesterday.");
    const tempId = `temp-${crypto.randomUUID()}`;
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
    const supabase = createClient();
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
      return;
    }
    setEntries((prev) =>
      prev.map((e) => (e.id === tempId ? (data as LogRow) : e)),
    );
  };

  const handleDelete = async (id: string) => {
    const prev = entries;
    setEntries((p) => p.filter((e) => e.id !== id));
    const error = await deleteEntry(id);
    if (error) {
      setEntries(prev);
      setError(error);
    }
  };

  const segments: { value: Filter; label: string }[] = [
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

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <header className="px-5 pt-7 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-footnote font-medium uppercase tracking-wider text-faint">
              {dateLabel}
            </p>
            <h1 className="mt-1 text-display">Today</h1>
            {hijriLabel && (
              <p className="mt-0.5 text-footnote text-muted">{hijriLabel}</p>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {/* Every entry and note, all time - Today only shows today's. */}
            <Link
              href="/journal"
              aria-label="Journal"
              className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted transition-colors hover:text-foreground"
            >
              <NotebookPen className="size-5" />
            </Link>
            <Link href="/settings" aria-label="Settings">
              <Avatar name={displayName} src={avatarUrl} />
            </Link>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 px-5">
        <div className="rounded-2xl bg-surface p-4 shadow-e1">
          <p className="text-footnote font-medium text-muted">Streak</p>
          <p className="mt-2 text-title1 tabular-nums">{streak}</p>
          <p className="text-footnote text-faint">
            {streak === 1 ? "day" : "days"} · longest {longest}
          </p>
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-e1">
          <p className="text-footnote font-medium text-muted">Logged today</p>
          <p className="mt-2 text-title1 tabular-nums">{todayEntries.length}</p>
          <p className="text-footnote text-faint">
            {todayEntries.length === 1 ? "entry" : "entries"}
          </p>
        </div>
      </div>

      {/* Resume-from bookmark - shows the next page to start on. */}
      {startPage != null && (
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 rounded-xl bg-accent-tint px-3.5 py-2.5 text-accent">
            <Bookmark className="size-4 shrink-0" />
            <span className="text-footnote font-medium">
              {finished ? "Khatm done 🎉 Start again from" : "Start from"} p.
              {startPage} · {bookmarkLabel(lastMushaf, startPage)}
            </span>
          </div>
        </div>
      )}

      {/* Filter (hifz only - readers have a single category) */}
      {mode !== "reading" && todayEntries.length > 0 && (
        <div className="px-5 pt-5">
          <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
            {segments.map((s) => (
              <button
                key={s.value}
                onClick={() => setFilter(s.value)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 font-medium transition-colors",
                  s.value === filter
                    ? "bg-surface text-foreground shadow-e1"
                    : "text-muted",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mx-5 mt-3 rounded-lg bg-danger-tint px-3 py-2 text-footnote text-danger">
          {error}
        </p>
      )}

      {/* Backdated entries don't appear in today's list - confirm the save. */}
      {notice && (
        <p className="mx-5 mt-3 rounded-lg bg-accent-tint px-3 py-2 text-footnote text-accent">
          {notice}
        </p>
      )}

      {/* Entries */}
      <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto px-5 pb-28">
        {/* One-time reminders for later today - the section is also the
            reminder door for single-type modes, whose FAB never fans out. */}
        {groupId && (
          <DayReminders
            ref={remindersRef}
            userId={userId}
            tz={tz}
            mode={mode}
            initial={initialDayReminders}
            entries={entries}
            serverNow={serverNow}
          />
        )}
        {!groupId ? (
          <EmptyState
            icon={UserPlus}
            title="You’re not in a circle yet"
            note="Ask the group owner to add you. Once you’re in, your logs and your circle’s feed show up here."
          />
        ) : todayEntries.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing logged yet today"
            note="Tap the + to log your first entry. Small and consistent wins."
          />
        ) : (
          <>
            <p className="px-1 text-footnote font-medium uppercase tracking-wider text-faint">
              Today’s entries
            </p>
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
              <p className="px-1 pt-2 text-footnote text-faint">
                No {filter} entries today.
              </p>
            )}
          </>
        )}
      </div>

      <SpeedDial
        mode={mode}
        onPick={handlePick}
        onReminder={() => remindersRef.current?.open()}
        disabled={!groupId}
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
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  note,
}: {
  icon: typeof Inbox;
  title: string;
  note: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 pt-12 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-accent-tint text-accent">
        <Icon className="size-7" strokeWidth={2} />
      </div>
      <p className="mt-4 text-callout font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-footnote text-muted">{note}</p>
    </div>
  );
}
