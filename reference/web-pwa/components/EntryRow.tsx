"use client";

import { Pencil, Trash2 } from "lucide-react";
import { dayLabel, localDate, timeLabel } from "@/lib/dates";
import { describeEntry, quantityLabel } from "@/lib/format";
import type { LogRow } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";

export function EntryRow({
  entry,
  tz,
  onEdit,
  onDelete,
  withDate = false,
  fullNotes = false,
}: {
  entry: LogRow;
  tz: string;
  onEdit?: (entry: LogRow) => void;
  onDelete?: (id: string) => void;
  /** Stamp with the day as well as the time (lists that span many days). */
  withDate?: boolean;
  /** Show the whole note on its own lines instead of one truncated line. */
  fullNotes?: boolean;
}) {
  const amt = quantityLabel(entry);
  const pending = entry.id.startsWith("temp-");
  const stamp = withDate
    ? `${dayLabel(localDate(entry.logged_at, tz))} · ${timeLabel(entry.logged_at, tz)}`
    : timeLabel(entry.logged_at, tz);
  const inlineNotes = fullNotes ? null : entry.notes;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge type={entry.entry_type} />
          <span className="text-caption text-faint tabular-nums">
            {pending ? "saving…" : stamp}
          </span>
        </div>
        <p className="mt-1.5 truncate text-callout font-semibold">
          {describeEntry(entry)}
        </p>
        {(amt || inlineNotes) && (
          <p className="truncate text-footnote text-muted">
            {amt}
            {amt && inlineNotes ? " · " : ""}
            {inlineNotes && <span className="text-faint">{inlineNotes}</span>}
          </p>
        )}
        {fullNotes && entry.notes && (
          <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-surface-2 px-3 py-2 text-footnote text-foreground">
            {entry.notes}
          </p>
        )}
      </div>
      {!pending && (onEdit || onDelete) && (
        <div className="flex shrink-0 items-center gap-0.5">
          {onEdit && (
            <button
              onClick={() => onEdit(entry)}
              aria-label="Edit entry"
              className="grid size-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(entry.id)}
              aria-label="Delete entry"
              className="grid size-8 place-items-center rounded-full text-faint transition-colors hover:bg-danger-tint hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
