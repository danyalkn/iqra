"use client";

import { useState } from "react";
import { Plus, Clock, Trash2, Bell, BellOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Reminder } from "@/lib/types";
import { DAY_INITIALS, formatTime, daysSummary } from "@/lib/reminders";
import { cn } from "@/lib/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, TimeInput } from "@/components/ui/Field";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function RemindersManager({
  userId,
  initial,
}: {
  userId: string;
  initial: Reminder[];
}) {
  const [reminders, setReminders] = useState<Reminder[]>(initial);
  const [editing, setEditing] = useState<Reminder | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortByTime = (rs: Reminder[]) =>
    [...rs].sort((a, b) => a.time.localeCompare(b.time));

  const toggle = async (r: Reminder) => {
    const next = !r.enabled;
    setReminders((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, enabled: next } : x)),
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("reminders")
      .update({ enabled: next })
      .eq("id", r.id);
    if (error) {
      setReminders((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, enabled: !next } : x)),
      );
      setError("Couldn’t update that reminder.");
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <FieldLabel>Daily reminders</FieldLabel>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1 text-subhead font-semibold text-accent"
        >
          <Plus className="size-4" strokeWidth={2.5} /> Add
        </button>
      </div>

      {error && (
        <p className="mb-2 text-footnote text-danger">{error}</p>
      )}

      {reminders.length === 0 ? (
        <div className="rounded-2xl bg-surface p-5 text-center shadow-e1">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent-tint text-accent">
            <Bell className="size-5" />
          </div>
          <p className="mt-3 text-callout font-semibold">No reminders yet</p>
          <p className="mt-1 text-footnote text-muted">
            Add a nudge or two so you don’t forget to log.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sortByTime(reminders).map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1"
            >
              <button
                onClick={() => setEditing(r)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl",
                    r.enabled
                      ? "bg-accent-tint text-accent"
                      : "bg-surface-2 text-faint",
                  )}
                >
                  <Clock className="size-5" />
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-callout font-semibold tabular-nums",
                      !r.enabled && "text-faint line-through",
                    )}
                  >
                    {formatTime(r.time)}
                  </p>
                  <p className="text-footnote text-muted">
                    {daysSummary(r.days)}
                  </p>
                </div>
              </button>
              <button
                onClick={() => toggle(r)}
                aria-label={r.enabled ? "Disable" : "Enable"}
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2"
              >
                {r.enabled ? (
                  <Bell className="size-4.5 text-accent" />
                ) : (
                  <BellOff className="size-4.5" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 px-1 text-footnote text-faint">
        Need a one-time nudge for later today or tomorrow? Set it from the
        Today page.
      </p>

      <ReminderSheet
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        userId={userId}
        reminder={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(saved, isNew) => {
          setReminders((prev) =>
            isNew
              ? [...prev, saved]
              : prev.map((x) => (x.id === saved.id ? saved : x)),
          );
          setEditing(null);
        }}
        onDeleted={(id) => {
          setReminders((prev) => prev.filter((x) => x.id !== id));
          setEditing(null);
        }}
      />
    </div>
  );
}

export function ReminderSheet({
  userId,
  reminder,
  open,
  onClose,
  onSaved,
  onDeleted,
}: {
  userId: string;
  reminder: Reminder | null;
  open: boolean;
  onClose: () => void;
  onSaved: (r: Reminder, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const [time, setTime] = useState(reminder ? reminder.time.slice(0, 5) : "06:00");
  const [days, setDays] = useState<number[]>(reminder ? reminder.days : ALL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) =>
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );

  const save = async () => {
    if (days.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const payload = { time, days: [...days].sort((a, b) => a - b), user_id: userId };

    if (reminder) {
      const { data, error } = await supabase
        .from("reminders")
        .update({ time: payload.time, days: payload.days })
        .eq("id", reminder.id)
        .select("*")
        .single();
      setBusy(false);
      if (error || !data) return setError("Couldn’t save. Try again.");
      onSaved(data as Reminder, false);
    } else {
      const { data, error } = await supabase
        .from("reminders")
        .insert({ ...payload, enabled: true })
        .select("*")
        .single();
      setBusy(false);
      if (error || !data) return setError("Couldn’t save. Try again.");
      onSaved(data as Reminder, true);
    }
  };

  const remove = async () => {
    if (!reminder) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("reminders")
      .delete()
      .eq("id", reminder.id);
    setBusy(false);
    if (error) return setError("Couldn’t delete.");
    onDeleted(reminder.id);
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="reminder-sheet-title">
      <div className="px-5 pt-2">
        <h2 id="reminder-sheet-title" className="mb-5 text-title2">
          {reminder ? "Edit reminder" : "New reminder"}
        </h2>

        <FieldLabel>Time</FieldLabel>
        <TimeInput value={time} onChange={setTime} ariaLabel="Time" />

        <div className="mt-5">
          <FieldLabel>Repeat on</FieldLabel>
          <div className="flex justify-between gap-1.5">
            {DAY_INITIALS.map((label, d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "grid size-10 flex-1 place-items-center rounded-xl text-subhead font-semibold transition-colors",
                    on
                      ? "bg-accent text-on-accent"
                      : "bg-surface-2 text-muted",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setDays(ALL)}
              className="rounded-full bg-surface-2 px-3 py-1 text-footnote font-medium text-muted"
            >
              Daily
            </button>
            <button
              onClick={() => setDays(WEEKDAYS)}
              className="rounded-full bg-surface-2 px-3 py-1 text-footnote font-medium text-muted"
            >
              Weekdays
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-footnote text-danger">{error}</p>}

        <div className="mt-6 flex gap-3">
          {reminder && (
            <Button variant="secondary" onClick={remove} disabled={busy}>
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button fullWidth onClick={save} loading={busy}>
            {reminder ? "Save" : "Add reminder"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
