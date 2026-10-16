"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, NotebookPen, StickyNote } from "lucide-react";
import { ENTRY_META, TYPES_BY_MODE, type EntryType, type Mode } from "@/lib/entries";
import { pageFromRef, type MushafId } from "@/lib/mushaf";
import { absolutePage, rowJuzPage } from "@/lib/position";
import type { LogRow, NewEntry } from "@/lib/types";
import { dayLabel, localDate, todayLocal, yesterdayLocal } from "@/lib/dates";
import { deleteEntry, markEntriesChanged, updateEntry } from "@/lib/entryWrites";
import { pagesEquiv } from "@/lib/entries";
import { cn } from "@/lib/cn";
import { EntryRow } from "@/components/EntryRow";
import { LogSheet } from "@/components/LogSheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type View = "day" | "juz";
type TypeFilter = "all" | EntryType;

/** How many rows render before "Show more" (all-time lists can be long). */
const PAGE = 120;

/** Sort key inside a juz: where in the mushaf the entry sits. Hifz rows use
 *  their in-juz start; reading rows their bookmark page; unplaced rows last. */
function placeKey(e: LogRow): number {
  const start = rowJuzPage(e);
  if (start != null && e.juz != null) {
    return absolutePage(e.mushaf, e.juz, start) + (start % 1 ? 0.5 : 0);
  }
  const page = e.entry_type === "reading" || e.entry_type === "revising"
    ? pageFromRef(e.to_ref)
    : null;
  return page ?? Number.POSITIVE_INFINITY;
}

export function JournalClient({
  mode,
  tz,
  mushaf,
  initialEntries,
}: {
  mode: Mode;
  tz: string;
  mushaf: MushafId;
  initialEntries: LogRow[];
}) {
  const [entries, setEntries] = useState<LogRow[]>(initialEntries);
  const hasNotes = useMemo(() => entries.some((e) => e.notes), [entries]);
  // Notes are the reason most people open this page - lead with them when
  // there are any.
  const [notesOnly, setNotesOnly] = useState(() =>
    initialEntries.some((e) => e.notes),
  );
  const [view, setView] = useState<View>("day");
  const [type, setType] = useState<TypeFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  // The entry in the edit sheet stays set while the sheet animates closed,
  // so its content doesn't flip to a blank form on the way out.
  const [editing, setEditing] = useState<LogRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayLocal(tz);
  const yesterday = yesterdayLocal(tz);

  // Type chips: only the types this person has actually logged, in the
  // order the log menu offers them.
  const typeChips = useMemo(() => {
    const present = new Set(entries.map((e) => e.entry_type));
    const order: EntryType[] = [
      ...TYPES_BY_MODE[mode],
      ...(["sabak", "sabak_para", "dor", "reading", "revising"] as EntryType[]),
    ];
    return [...new Set(order)].filter((t) => present.has(t));
  }, [entries, mode]);

  // A type whose last entry was deleted drops out of the chips; fall back to
  // all types rather than leave an invisible filter on.
  const activeType: TypeFilter =
    type !== "all" && !typeChips.includes(type) ? "all" : type;

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!notesOnly || !!e.notes) &&
          (activeType === "all" || e.entry_type === activeType),
      ),
    [entries, notesOnly, activeType],
  );
  const shown = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  const byDay = useMemo(() => {
    const out: [string, LogRow[]][] = [];
    for (const e of shown) {
      const d = localDate(e.logged_at, tz);
      const last = out[out.length - 1];
      if (last && last[0] === d) last[1].push(e);
      else out.push([d, [e]]);
    }
    return out;
  }, [shown, tz]);

  // By juz groups the WHOLE filtered list (a juz section must be complete),
  // and "Show more" reveals whole sections instead of the next rows by date.
  const byJuz = useMemo(() => {
    const groups = new Map<number, LogRow[]>();
    for (const e of filtered) {
      const key = e.juz ?? 0; // 0 = no juz recorded
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    }
    for (const list of groups.values()) {
      list.sort(
        (a, b) =>
          placeKey(a) - placeKey(b) ||
          (a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0),
      );
    }
    // Juz order, with anything unplaced at the end.
    return [...groups.entries()].sort(
      (a, b) => (a[0] || 99) - (b[0] || 99),
    );
  }, [filtered]);
  const juzShown = useMemo(() => {
    const out: [number, LogRow[]][] = [];
    let rows = 0;
    for (const g of byJuz) {
      if (out.length > 0 && rows + g[1].length > limit) break;
      out.push(g);
      rows += g[1].length;
    }
    return { groups: out, rows };
  }, [byJuz, limit]);
  const hiddenCount =
    view === "day"
      ? filtered.length - shown.length
      : filtered.length - juzShown.rows;

  const dayHeading = (ymd: string) =>
    ymd === today ? "Today" : ymd === yesterday ? "Yesterday" : dayLabel(ymd);

  // Failed writes roll back only the row they touched, so a failure never
  // undoes another edit or delete that succeeded in the meantime.
  const handleSave = async (payload: NewEntry) => {
    if (!editing) return;
    const id = editing.id;
    const before = entries.find((e) => e.id === id);
    const { logged_at: _omit, ...fields } = payload;
    void _omit;
    setEntries((p) =>
      p.map((e) =>
        e.id === id
          ? { ...e, ...fields, pages_equiv: pagesEquiv(payload.amount, payload.unit) }
          : e,
      ),
    );
    setError(null);
    const { row, error: err } = await updateEntry(id, payload);
    if (err || !row) {
      if (before) setEntries((p) => p.map((e) => (e.id === id ? before : e)));
      setError(err ?? "Couldn’t save your changes. Try again.");
      return;
    }
    setEntries((p) => p.map((e) => (e.id === id ? row : e)));
    markEntriesChanged();
  };

  const handleDelete = async (id: string) => {
    const removed = entries.find((e) => e.id === id);
    setEntries((p) => p.filter((e) => e.id !== id));
    setError(null);
    const err = await deleteEntry(id);
    if (err) {
      // Put it back where it belongs (the list is newest first).
      if (removed) {
        setEntries((p) =>
          [...p, removed].sort((a, b) =>
            a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0,
          ),
        );
      }
      setError(err);
      return;
    }
    markEntriesChanged();
  };

  const countLabel = notesOnly
    ? `${filtered.length} ${filtered.length === 1 ? "note" : "notes"}`
    : `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;

  const row = (e: LogRow, withDate: boolean) => (
    <EntryRow
      key={e.id}
      entry={e}
      tz={tz}
      withDate={withDate}
      fullNotes
      onEdit={(x) => {
        setEditing(x);
        setSheetOpen(true);
      }}
      onDelete={handleDelete}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-10">
      <header className="flex items-center gap-3 px-5 pt-7 pb-1">
        <Link
          href="/today"
          aria-label="Back"
          className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-title1">Journal</h1>
      </header>
      <p className="px-5 text-footnote text-muted">
        Everything you’ve logged, with your notes.
      </p>

      <div className="space-y-3 px-5 pt-4">
        <SegmentedControl
          segments={[
            { value: "day", label: "By day" },
            { value: "juz", label: "By juz" },
          ]}
          value={view}
          onChange={(v) => setView(v)}
        />

        {/* Filters: notes first, then the entry types you actually use. */}
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
          <Chip
            active={notesOnly}
            onClick={() => {
              setNotesOnly((v) => !v);
              setLimit(PAGE);
            }}
          >
            <StickyNote className="size-3.5" /> With notes
          </Chip>
          {typeChips.length > 1 && (
            <>
              <span className="my-1 w-px shrink-0 bg-border" />
              <Chip active={activeType === "all"} onClick={() => setType("all")}>
                All types
              </Chip>
              {typeChips.map((t) => (
                <Chip
                  key={t}
                  active={activeType === t}
                  onClick={() => {
                    setType(t);
                    setLimit(PAGE);
                  }}
                >
                  {ENTRY_META[t].label}
                </Chip>
              ))}
            </>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-danger-tint px-3 py-2 text-footnote text-danger">
            {error}
          </p>
        )}

        {filtered.length > 0 && (
          <p className="px-1 text-footnote text-faint">
            {countLabel}
            {view === "juz" ? " · in mushaf order within each juz" : ""}
          </p>
        )}
      </div>

      <div className="mt-2 space-y-5 px-5">
        {entries.length === 0 ? (
          <Empty
            title="Nothing logged yet"
            note="Your entries and the notes you add to them collect here, day after day."
          />
        ) : filtered.length === 0 ? (
          <Empty
            title={notesOnly && !hasNotes ? "No notes yet" : "Nothing matches"}
            note={
              notesOnly && !hasNotes
                ? "When you log, tap “Add a note” to write down what you covered or how it went. It will show up here."
                : "Try another filter."
            }
          />
        ) : view === "day" ? (
          byDay.map(([ymd, rows]) => (
            <section key={ymd}>
              <p className="mb-2 px-1 text-footnote font-medium uppercase tracking-wider text-faint">
                {dayHeading(ymd)}
              </p>
              <div className="space-y-2.5">{rows.map((e) => row(e, false))}</div>
            </section>
          ))
        ) : (
          juzShown.groups.map(([juz, rows]) => (
            <section key={juz}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <p className="text-footnote font-medium uppercase tracking-wider text-faint">
                  {juz === 0 ? "No juz recorded" : `Juz ${juz}`}
                </p>
                <span className="text-caption text-faint">
                  {rows.length} {rows.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              <div className="space-y-2.5">{rows.map((e) => row(e, true))}</div>
            </section>
          ))
        )}

        {hiddenCount > 0 && (
          <button
            onClick={() => setLimit((l) => l + PAGE)}
            className="w-full rounded-xl bg-surface-2 py-2.5 text-subhead font-medium text-muted"
          >
            {view === "day"
              ? `Show more (${hiddenCount} older)`
              : `Show more juz (${hiddenCount} more ${hiddenCount === 1 ? "entry" : "entries"})`}
          </button>
        )}
      </div>

      <LogSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        initialType={editing?.entry_type ?? "reading"}
        onSave={handleSave}
        editing={editing}
        mushaf={mushaf}
        tz={tz}
      />
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-footnote font-medium transition-colors",
        active ? "bg-accent-tint text-accent" : "bg-surface-2 text-muted",
      )}
    >
      {children}
    </button>
  );
}

function Empty({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col items-center px-6 pt-10 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-accent-tint text-accent">
        <NotebookPen className="size-7" strokeWidth={2} />
      </div>
      <p className="mt-4 text-callout font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-footnote text-muted">{note}</p>
    </div>
  );
}
