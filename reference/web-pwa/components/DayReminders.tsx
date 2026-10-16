"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import Link from "next/link";
import {
  AlarmClock,
  AlarmClockCheck,
  AlarmClockPlus,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ENTRY_META,
  TYPES_BY_MODE,
  type EntryType,
  type Mode,
} from "@/lib/entries";
import type { DayReminder, LogRow } from "@/lib/types";
import { localDate, nextYmd, todayLocal, tomorrowLocal } from "@/lib/dates";
import {
  dayReminderInFuture,
  dayReminderPresets,
  dayReminderStatus,
  formatTime,
  sortDayReminders,
  type DayReminderStatus,
} from "@/lib/reminders";
import { getPushState, type PushState } from "@/lib/push";
import { cn } from "@/lib/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, Input, TimeInput } from "@/components/ui/Field";

export type DayRemindersHandle = { open: () => void };

type PushKnown = PushState | "loading";

// Push state is stable for a session except the "off" answer, which the 3s
// serviceWorker.ready race can return on a cold start. Cache everything else.
let cachedPush: PushState | null = null;

/**
 * One-time reminders for later today (or tomorrow), shown at the top of the
 * Today list. Owns its rows and its sheet; the speed dial reaches in through
 * the `ref` to open the sheet, so both doors share one piece of state.
 *
 * Status is driven by the row (sent_at / skipped_at) and by the same
 * "already logged" rule the cron uses, never by the clock alone: a check mark
 * must mean something actually happened. "Sent" is only claimed when this
 * device has push on; otherwise the row just says the time has passed.
 */
export function DayReminders({
  ref,
  userId,
  tz,
  mode,
  initial,
  entries,
  serverNow,
}: {
  ref?: Ref<DayRemindersHandle>;
  userId: string;
  tz: string;
  mode: Mode;
  initial: DayReminder[];
  /** The user's recent entries, for the live "Logged" preview. */
  entries: LogRow[];
  /** Server clock at render, so the first paint matches on both sides. */
  serverNow: number;
}) {
  const [reminders, setReminders] = useState<DayReminder[]>(initial);
  const [now, setNow] = useState(serverNow);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Bumped on every open so the sheet remounts with fresh time-of-day
  // defaults, while a closing sheet keeps its instance for the exit slide.
  const [sheetKey, setSheetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [push, setPush] = useState<PushKnown>(() => cachedPush ?? "loading");
  // Ids mid-delete: a refetch that lands after the optimistic removal must
  // not bring the row back. The mutation counter covers the other order: a
  // refetch that STARTED before a delete or add and lands after it is stale.
  const deleting = useRef(new Set<string>());
  const mutations = useRef(0);
  // Latest rows for the timer, which must not re-arm on every change.
  const latest = useRef(reminders);
  useEffect(() => {
    latest.current = reminders;
  }, [reminders]);

  const checkPush = useCallback(() => {
    getPushState()
      .then((s) => {
        if (s !== "off") cachedPush = s;
        setPush(s);
      })
      .catch(() => setPush("unsupported"));
  }, []);
  // Resolve push state at page load, well before the sheet opens, so the
  // warning is known up front instead of shifting the layout under a thumb.
  useEffect(() => {
    if (!cachedPush) checkPush();
  }, [checkPush]);

  const openSheet = useCallback(() => {
    // A cold-start "off" may have been the race; look again before warning.
    if (!cachedPush) checkPush();
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }, [checkPush]);
  useImperativeHandle(ref, () => ({ open: openSheet }), [openSheet]);

  const refetch = useCallback(async () => {
    const seq = mutations.current;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("day_reminders")
      .select("*")
      .eq("user_id", userId)
      .gte("remind_on", todayLocal(tz))
      .lte("remind_on", tomorrowLocal(tz))
      .order("remind_on", { ascending: true })
      .order("time", { ascending: true });
    if (error || !data || seq !== mutations.current) return;
    setReminders(
      (data as DayReminder[]).filter((r) => !deleting.current.has(r.id)),
    );
  }, [userId, tz]);

  // Minute-aligned clock. Each tick also refetches when it matters: the
  // local date rolled over on an open tab (yesterday's rows go, tomorrow's
  // become today's), or a row is due and the job should have marked it by
  // now. Foreground return refetches unconditionally (iOS suspends timers;
  // both events, since iOS standalone often fires only one of them).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastYmd = todayLocal(tz);
    const tick = (force: boolean) => {
      const t = Date.now();
      setNow(t);
      const ymd = localDate(t, tz);
      const due = latest.current.some(
        (r) =>
          !r.sent_at && !r.skipped_at && new Date(r.due_at).getTime() <= t,
      );
      if (force || due || ymd !== lastYmd) {
        lastYmd = ymd;
        void refetch();
      }
    };
    const arm = () => {
      timer = setTimeout(
        () => {
          tick(false);
          arm();
        },
        60_000 - (Date.now() % 60_000) + 50,
      );
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === "visible") tick(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch, tz]);

  const remove = async (id: string) => {
    const prev = reminders;
    mutations.current += 1;
    deleting.current.add(id);
    setReminders((p) => p.filter((r) => r.id !== id));
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("day_reminders").delete().eq("id", id);
    deleting.current.delete(id);
    if (error) {
      setReminders(prev);
      setError("Couldn’t remove that reminder.");
    }
  };

  const today = localDate(now, tz);
  // Yesterday's rows drop out at midnight even before the refetch lands.
  const visible = sortDayReminders(reminders).filter(
    (r) => r.remind_on >= today,
  );
  const loggedToday = new Set(
    entries
      .filter((e) => localDate(e.logged_at, tz) === today)
      .map((e) => e.entry_type),
  );

  return (
    <div className="pb-2">
      {visible.length === 0 ? (
        <button
          type="button"
          onClick={openSheet}
          className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3.5 text-left shadow-e1"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
            <AlarmClockPlus className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-callout font-semibold">Remind me</span>
            <span className="block text-footnote text-muted">
              A one-time nudge for later today or tomorrow.
            </span>
          </span>
        </button>
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-footnote font-medium uppercase tracking-wider text-faint">
              One-time reminders
            </p>
            <button
              type="button"
              onClick={openSheet}
              className="inline-flex items-center gap-1 text-subhead font-semibold text-accent"
            >
              <Plus className="size-4" strokeWidth={2.5} /> Add
            </button>
          </div>
          <div className="space-y-2.5">
            {visible.map((r) => (
              <DayReminderRow
                key={r.id}
                reminder={r}
                status={dayReminderStatus(r, entries, now, tz)}
                tomorrow={r.remind_on > today}
                pushOn={push === "on"}
                onDelete={() => remove(r.id)}
              />
            ))}
          </div>
        </>
      )}

      {error && <p className="mt-2 px-1 text-footnote text-danger">{error}</p>}

      <DayReminderSheet
        key={sheetKey}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        userId={userId}
        tz={tz}
        mode={mode}
        loggedTypes={loggedToday}
        push={push}
        onSaved={(saved) => {
          mutations.current += 1;
          setReminders((p) => [...p, saved]);
        }}
      />
    </div>
  );
}

function DayReminderRow({
  reminder: r,
  status,
  tomorrow,
  pushOn,
  onDelete,
}: {
  reminder: DayReminder;
  status: DayReminderStatus;
  tomorrow: boolean;
  pushOn: boolean;
  onDelete: () => void;
}) {
  const done = status === "sent" || status === "logged";
  const label = r.entry_type ? ENTRY_META[r.entry_type].label : null;
  const what = [label, r.note].filter(Boolean).join(" · ") || "A little Quran";
  const Icon = done ? AlarmClockCheck : AlarmClock;
  // Honest states: "Sent" only when this device can receive it; "Logged" when
  // the thing it was for got done first; "Due" while the job is still on it.
  const suffix =
    status === "logged"
      ? "Logged"
      : status === "sent"
        ? pushOn
          ? "Sent"
          : "Time passed"
        : status === "due"
          ? "Due"
          : null;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          done
            ? "bg-surface-2 text-faint"
            : status === "due"
              ? "bg-warn-tint text-warn"
              : "bg-accent-tint text-accent",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-callout font-semibold tabular-nums">
          <span className={cn(done && "text-faint line-through")}>
            {tomorrow ? "Tomorrow " : ""}
            {formatTime(r.time)}
          </span>
          {suffix && (
            <span
              className={cn(
                "ml-2 text-footnote font-medium",
                status === "due" ? "text-warn" : "text-faint",
              )}
            >
              {suffix}
            </span>
          )}
        </p>
        <p className="truncate text-footnote text-muted">{what}</p>
      </div>
      <button
        onClick={onDelete}
        aria-label={done ? "Remove reminder" : "Cancel reminder"}
        className="grid size-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-danger-tint hover:text-danger"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

const PUSH_OFF_NOTE: Record<Exclude<PushState, "on">, string> = {
  off: "Notifications are off on this phone, so this will only show here on Today.",
  "needs-install":
    "On iPhone, add Iqra to your Home Screen to get this as a notification. Until then it only shows here on Today.",
  denied:
    "Notifications are blocked for Iqra in your browser settings, so this will only show here on Today.",
  unsupported:
    "This browser can’t show notifications, so this will only show here on Today.",
};

export function DayReminderSheet({
  open,
  onClose,
  userId,
  tz,
  mode,
  loggedTypes,
  push,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  tz: string;
  mode: Mode;
  /** Entry types already logged today (picks the first one still to do). */
  loggedTypes: Set<EntryType>;
  push: PushKnown;
  onSaved: (r: DayReminder) => void;
}) {
  const types = TYPES_BY_MODE[mode];
  const pickType = types.length > 1; // readers are implicitly "reading"

  // Pinned once per open (the parent keys this component on each open): the
  // dates behind "Today" and "Tomorrow", and the quick picks. A save that
  // straddles midnight still targets the day the member was looking at.
  const [base] = useState(() => {
    const nowMs = Date.now();
    const today = localDate(nowMs, tz);
    return {
      today,
      tomorrow: nextYmd(today),
      presets: dayReminderPresets(nowMs, tz),
    };
  });
  const initial =
    base.presets.find((p) => p.label === "In 1 hour") ?? base.presets[0];
  const [ymd, setYmd] = useState(initial.ymd);
  const [time, setTime] = useState(initial.time);
  const [type, setType] = useState<EntryType | null>(() =>
    pickType ? (types.find((t) => !loggedTypes.has(t)) ?? null) : types[0],
  );
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceTz] = useState(() =>
    typeof Intl === "undefined"
      ? tz
      : Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  const save = async () => {
    if (!time) {
      setError("Pick a time.");
      return;
    }
    if (!dayReminderInFuture(ymd, time, Date.now(), tz)) {
      setError("Pick a time that hasn’t passed yet.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("day_reminders")
      .insert({
        user_id: userId,
        remind_on: ymd,
        time,
        entry_type: type,
        note: note.trim() || null,
      })
      .select("*")
      .single();
    setBusy(false);
    if (error || !data) {
      const msg = error?.message ?? "";
      setError(
        /already passed|today or tomorrow/i.test(msg)
          ? "That time has already passed. Pick a later one."
          : /plenty of reminders/i.test(msg)
            ? "That’s plenty of reminders for one day. Clear a few first."
            : "Couldn’t set that reminder. Try again.",
      );
      return;
    }
    onSaved(data as DayReminder);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="day-reminder-title">
      <div className="px-5 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="day-reminder-title" className="text-title2">
            Remind me
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-5 text-footnote text-muted">
          A one-time nudge. Your daily reminders live in Settings.
        </p>

        <FieldLabel>When</FieldLabel>
        <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
          {(
            [
              ["today", base.today],
              ["tomorrow", base.tomorrow],
            ] as const
          ).map(([label, d]) => (
            <button
              key={label}
              type="button"
              onClick={() => setYmd(d)}
              className={cn(
                "flex-1 rounded-lg py-1.5 font-medium capitalize transition-colors",
                ymd === d ? "bg-surface text-foreground shadow-e1" : "text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {base.presets.map((p) => {
            const on = p.ymd === ymd && p.time === time;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setYmd(p.ymd);
                  setTime(p.time);
                }}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-subhead font-semibold transition-colors",
                  on ? "bg-accent text-on-accent" : "bg-surface-2 text-muted",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <TimeInput value={time} onChange={setTime} ariaLabel="Time" />
        </div>
        {deviceTz !== tz && (
          <p className="mt-1.5 px-1 text-footnote text-faint">
            Times are in {tz}.
          </p>
        )}

        {pickType && (
          <div className="mt-5">
            <FieldLabel>What for</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-subhead font-semibold transition-colors",
                    type === t
                      ? "bg-accent text-on-accent"
                      : "bg-surface-2 text-muted",
                  )}
                >
                  {ENTRY_META[t].label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setType(null)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-subhead font-semibold transition-colors",
                  type === null
                    ? "bg-accent text-on-accent"
                    : "bg-surface-2 text-muted",
                )}
              >
                Anything
              </button>
            </div>
          </div>
        )}
        {type && (
          <p className="mt-2 px-1 text-footnote text-faint">
            If you log {ENTRY_META[type].label} before then, this stays quiet.
          </p>
        )}

        <div className="mt-5">
          {showNote ? (
            <>
              <FieldLabel>Note</FieldLabel>
              <Input
                placeholder="After Isha, Juz 5…"
                value={note}
                maxLength={120}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
              />
              <p className="mt-1.5 px-1 text-footnote text-faint">
                This becomes the notification text.
              </p>
            </>
          ) : (
            <button
              onClick={() => setShowNote(true)}
              className="inline-flex items-center gap-1.5 text-subhead font-medium text-accent"
            >
              <Plus className="size-4" strokeWidth={2.5} /> Add a note
            </button>
          )}
        </div>

        {push !== "loading" && push !== "on" && (
          <div className="mt-5 rounded-xl border border-warn/30 bg-warn-tint px-4 py-3 text-footnote text-foreground">
            {PUSH_OFF_NOTE[push]}{" "}
            {push === "off" && (
              <Link href="/settings" className="font-semibold text-accent">
                Turn them on in Settings.
              </Link>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-footnote text-danger">{error}</p>}

        <Button fullWidth className="mt-6" onClick={save} loading={busy}>
          Set reminder
        </Button>
      </div>
    </Sheet>
  );
}
