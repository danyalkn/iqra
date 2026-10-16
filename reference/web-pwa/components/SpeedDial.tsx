"use client";

import { useState } from "react";
import { AlarmClockPlus, Plus } from "lucide-react";
import {
  ENTRY_META,
  type EntryType,
  type Mode,
  TYPES_BY_MODE,
} from "@/lib/entries";
import { ENTRY_ICON } from "@/components/entryIcons";
import { cn } from "@/lib/cn";

/** Google-Calendar-style expanding FAB. Scrim + pills + button all live in the
 *  Today container (same coordinate space) so the pills sit cleanly above the
 *  button. Tap the + to fan out the entry types for the user's mode. */
export function SpeedDial({
  mode,
  onPick,
  onReminder,
  disabled,
  defaultOpen = false,
}: {
  mode: Mode;
  onPick: (type: EntryType) => void;
  /** Opens the one-time reminder sheet. Only joins a fan-out that already
   *  exists: a single-type mode keeps its one-tap FAB (readers log every
   *  day) and reaches reminders through the section on Today instead. */
  onReminder?: () => void;
  disabled?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const types = TYPES_BY_MODE[mode];
  const single = types.length === 1;
  const reminderPill = !single && Boolean(onReminder);

  const choose = (t: EntryType) => {
    setOpen(false);
    onPick(t);
  };

  const remind = () => {
    setOpen(false);
    onReminder?.();
  };

  const onFab = () => {
    if (single) onPick(types[0]); // skip the fan-out for a single option
    else setOpen((v) => !v);
  };

  return (
    <>
      {open && (
        <div
          className="absolute inset-0 z-40 bg-black/30 animate-[fadeIn_140ms_ease-out]"
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        <div className="absolute bottom-[6rem] right-4 z-50 flex flex-col items-end gap-3.5">
          {/* Reminder sits at the top, apart from the entry types below, in a
              neutral well so it reads as a different kind of action. */}
          {reminderPill && (
            <button
              onClick={remind}
              className="mb-1.5 flex items-center gap-3.5 rounded-full bg-surface py-3.5 pl-7 pr-3.5 shadow-e2 [will-change:transform,opacity] animate-[dialIn_170ms_var(--ease-spring)_both]"
            >
              <span className="text-[1.0625rem] font-semibold">Remind me</span>
              <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-muted">
                <AlarmClockPlus className="size-5" strokeWidth={2.25} />
              </span>
            </button>
          )}
          {types.map((t, i) => {
            const Icon = ENTRY_ICON[t];
            return (
              <button
                key={t}
                onClick={() => choose(t)}
                style={{
                  animationDelay: `${(i + (reminderPill ? 1 : 0)) * 22}ms`,
                }}
                className="flex items-center gap-3.5 rounded-full bg-surface py-3.5 pl-7 pr-3.5 shadow-e2 [will-change:transform,opacity] animate-[dialIn_170ms_var(--ease-spring)_both]"
              >
                <span className="text-[1.0625rem] font-semibold">
                  {ENTRY_META[t].label}
                </span>
                <span className="grid size-11 place-items-center rounded-full bg-accent-tint text-accent">
                  <Icon className="size-5" strokeWidth={2.25} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        aria-label={open ? "Close" : "Add entry"}
        aria-expanded={open}
        disabled={disabled}
        onClick={onFab}
        className={cn(
          "absolute bottom-5 right-4 z-50 grid size-16 place-items-center rounded-full shadow-e3 transition",
          "bg-accent text-on-accent active:scale-95 disabled:opacity-40 motion-reduce:active:scale-100",
        )}
      >
        <Plus
          className={cn(
            "size-8 transition-transform duration-300",
            open && "rotate-45",
          )}
          strokeWidth={2.5}
        />
      </button>
    </>
  );
}
