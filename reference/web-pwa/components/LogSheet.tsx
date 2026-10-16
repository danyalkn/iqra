"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Plus } from "lucide-react";
import {
  ENTRY_META,
  isReadingType,
  type EntryType,
  type Unit,
} from "@/lib/entries";
import type { LogRow, NewEntry } from "@/lib/types";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, FieldLabel } from "@/components/ui/Field";
import { WheelPicker } from "@/components/WheelPicker";
import {
  totalPages,
  clampPage,
  locatePage,
  pageFromRef,
  DEFAULT_MUSHAF,
  type MushafId,
} from "@/lib/mushaf";
import {
  absolutePage,
  juzLength,
  juzPageFromLabel,
  juzPageLabel,
  juzPageOptions,
  needsQuarters,
  nextSabakStart,
  pagesPhrase,
  positionLabel,
  positionSaysAmount,
  rowJuzPage,
  serializeJuzPage,
} from "@/lib/position";
import { BACKDATE_CUTOFF, localHm, yesterdayLocal, zonedIso } from "@/lib/dates";
import { cn } from "@/lib/cn";

type Portion = "Full" | "Half" | "Quarter" | "Pages";
const PORTIONS: Portion[] = ["Full", "Half", "Quarter", "Pages"];
const JUZ = Array.from({ length: 30 }, (_, i) => i + 1);

// Sabak (new memorization) is never more than a quarter (~5 pages) at a time.
const SABAK_PAGES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5];
// Revision can cover more.
const REV_PAGES = [
  0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20,
];

const PORTION_UNIT: Record<Exclude<Portion, "Pages">, Unit> = {
  Full: "juz",
  Half: "hizb",
  Quarter: "quarter",
};

function defaultPortion(t: EntryType): Portion {
  return t === "dor" ? "Full" : "Quarter";
}

/** Reconstruct the portion wheel from a saved revision entry's unit. */
function portionFromUnit(unit: Unit | null): Portion {
  if (unit === "juz") return "Full";
  if (unit === "hizb") return "Half";
  if (unit === "quarter") return "Quarter";
  return "Pages";
}

// The "Starts at" wheel: "–" = not specified, then half-page steps (quarter
// steps whenever the amount or the start needs them).
const NO_START = "–";
function startFromLabel(label: string): number | null {
  return label === NO_START ? null : juzPageFromLabel(label);
}

/** "Juz 3 · p.3, 2nd half" (+ the amount when the label doesn't say it). */
function portionSummary(juz: number, start: number | null, pages: number): string {
  if (start == null) return `Juz ${juz} · ${pagesPhrase(pages)}`;
  const where = positionLabel(start, pages);
  return positionSaysAmount(start, pages)
    ? `Juz ${juz} · ${where}`
    : `Juz ${juz} · ${where} · ${pagesPhrase(pages)}`;
}

export function LogSheet({
  open,
  onClose,
  initialType,
  onSave,
  editing,
  lastReadPage,
  lastOfType,
  mushaf = DEFAULT_MUSHAF,
  tz,
}: {
  open: boolean;
  onClose: () => void;
  initialType: EntryType;
  onSave: (entry: NewEntry) => void;
  /** When set, the sheet edits this entry instead of creating a new one. */
  editing?: LogRow | null;
  /** Most recent last-page read, used to auto-advance the bookmark. */
  lastReadPage?: number | null;
  /** The newest entry of this type: a fresh hifz entry carries on from it
   *  (sabak continues right after it; revisions reuse its juz/portion). */
  lastOfType?: LogRow | null;
  /** The reader's mushaf - drives the page→juz/surah map and page range. */
  mushaf?: MushafId;
  /** Profile timezone - backdating must land on the right local day. */
  tz: string;
}) {
  // A reading being edited keeps its own mushaf (its bookmark page is in
  // it). Hifz positions are juz-relative, so they always use the user's
  // mushaf; older hifz rows only carry the column's default.
  const mush: MushafId =
    editing && isReadingType(editing.entry_type)
      ? (editing.mushaf ?? mushaf)
      : mushaf;
  const maxPage = totalPages(mush);
  const reading = isReadingType(initialType);
  const sabak = initialType === "sabak";
  const meta = ENTRY_META[initialType];
  const verb = sabak ? "memorizing" : "revising";

  // hifz
  const [juz, setJuz] = useState(1);
  const [portion, setPortion] = useState<Portion>(defaultPortion(initialType));
  const [part, setPart] = useState(1);
  const [pages, setPages] = useState(1); // sabak + revision "Pages"
  // Where in the juz the portion starts (juz-relative page, half steps).
  const [start, setStart] = useState<number | null>(null);
  // reading
  const [pagesRead, setPagesRead] = useState("");
  const [stoppedAt, setStoppedAt] = useState("");
  // When on, the last page = previous bookmark + pages read (auto-advance).
  const [autoPage, setAutoPage] = useState(true);
  // shared
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [when, setWhen] = useState<"today" | "yesterday">("today");
  // Only between midnight and 3 AM can an entry go to yesterday; decided
  // when the sheet opens, in the profile's timezone.
  const [canBackdate, setCanBackdate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The defaults below read the newest entry of this type, but only when the
  // sheet opens: a save confirming in the background swaps that row for the
  // server's copy, and re-running the reset then would wipe what's being
  // typed. The ref keeps the latest value without re-triggering the reset.
  const lastRef = useRef(lastOfType);
  useEffect(() => {
    lastRef.current = lastOfType;
  }, [lastOfType]);

  // An open sheet can outlive the window either way (an iPhone puts the app
  // away with the sheet up): re-check when the app comes back to the front.
  // If yesterday was picked and has since closed, say so instead of quietly
  // saving to the wrong day.
  const whenRef = useRef(when);
  useEffect(() => {
    whenRef.current = when;
  }, [when]);
  useEffect(() => {
    if (!open) return;
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      const ok = localHm(Date.now(), tz) < BACKDATE_CUTOFF;
      setCanBackdate(ok);
      if (!ok && whenRef.current === "yesterday") {
        setWhen("today");
        setError("It’s past 3 AM, so yesterday is closed. This will save for today.");
      }
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [open, tz]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setWhen("today");
    setCanBackdate(localHm(Date.now(), tz) < BACKDATE_CUTOFF);
    setNotes(editing?.notes ?? "");
    setShowNotes(Boolean(editing?.notes));

    // Auto-advance on by default for a fresh reading; off when editing so the
    // stored page shows as-is.
    setAutoPage(!editing);

    if (editing) {
      // Prefill from the entry being edited.
      if (isReadingType(editing.entry_type)) {
        setPagesRead(editing.amount != null ? String(editing.amount) : "");
        const p = pageFromRef(editing.to_ref);
        setStoppedAt(p != null ? String(p) : "");
      } else if (editing.entry_type === "sabak") {
        setJuz(editing.juz ?? 1);
        setPages(editing.amount ?? 1);
        setStart(rowJuzPage(editing));
      } else {
        setJuz(editing.juz ?? 1);
        setPortion(portionFromUnit(editing.unit));
        setPart(editing.part ?? 1);
        setPages(editing.amount ?? 1);
        setStart(rowJuzPage(editing));
      }
      return;
    }

    // Fresh entry defaults: carry on from the last entry of this type, so
    // tomorrow's sabak is usually one tap.
    const last = lastRef.current ?? null;
    setPagesRead("");
    setStoppedAt("");
    if (initialType === "sabak") {
      const next = nextSabakStart(last, mush);
      setJuz(next?.juz ?? last?.juz ?? 1);
      setStart(next?.start ?? null);
      const amt = last?.amount != null ? +last.amount : 1;
      setPages(SABAK_PAGES.includes(amt) ? amt : 1);
      setPortion(defaultPortion(initialType));
      setPart(1);
    } else if (!isReadingType(initialType) && last) {
      const p = portionFromUnit(last.unit);
      setJuz(last.juz ?? 1);
      setPortion(p);
      // Quarters and halves usually rotate: suggest the next one.
      const max = p === "Half" ? 2 : p === "Quarter" ? 4 : 1;
      setPart(last.part ? (last.part % max) + 1 : 1);
      const amt = last.amount != null ? +last.amount : 1;
      setPages(p === "Pages" && REV_PAGES.includes(amt) ? amt : 1);
      setStart(rowJuzPage(last));
    } else {
      setJuz(1);
      setPortion(defaultPortion(initialType));
      setPart(1);
      setPages(1);
      setStart(null);
    }
  }, [open, initialType, editing, mush, tz]);

  const backdating = when === "yesterday" && !editing;

  const partOptions =
    portion === "Half" ? [1, 2] : portion === "Quarter" ? [1, 2, 3, 4] : [];

  // "Starts at" wheel for the chosen juz (its length depends on the juz and
  // the mushaf: Uthmani juz 1 has 21 pages, juz 30 has 23).
  const step =
    needsQuarters(start, sabak || portion === "Pages" ? pages : null) ? 0.25 : 0.5;
  const startOptions = useMemo(
    () => [NO_START, ...juzPageOptions(mush, juz, step).map(juzPageLabel)],
    [mush, juz, step],
  );
  const startValue = start == null ? NO_START : juzPageLabel(start);
  const onJuzChange = (j: number) => {
    setJuz(j);
    const max = juzLength(mush, j) + 1 - step;
    setStart((s) => (s == null ? s : Math.min(s, max)));
  };
  // The printed page number, for a quick check against the mushaf in hand.
  const mushafPage =
    start != null && mush === "uthmani15"
      ? ` · mushaf p.${absolutePage(mush, juz, start)}`
      : "";

  // Reading: resolve the entered last-page into its mushaf location, live.
  const stoppedNum = Number(stoppedAt);
  const stoppedValid =
    /^\d+$/.test(stoppedAt) && stoppedNum >= 1 && stoppedNum <= maxPage;
  const readLoc = stoppedValid ? locatePage(mush, stoppedNum) : null;

  // Auto-advance: new last page = previous bookmark + pages read.
  const readAmt = Number(pagesRead);
  const readAmtValid = pagesRead.trim() !== "" && !Number.isNaN(readAmt) && readAmt > 0;
  const autoLastPage = readAmtValid
    ? clampPage(mush, Math.round((lastReadPage ?? 0) + readAmt))
    : null;
  const autoLoc = autoLastPage != null ? locatePage(mush, autoLastPage) : null;
  // Never auto-advance a backdated entry: `lastReadPage` is where the user is
  // *now*, so adding yesterday's pages onto it would push the bookmark past
  // their real position and double-count on the next reading.
  const autoAdvance = autoPage && !backdating;
  // The location we'll actually store for this reading.
  const finalLoc = autoAdvance ? autoLoc : readLoc;

  // Numbers only - up to 2 decimal places for pages, integer for the page no.
  const onPagesReadChange = (v: string) => {
    if (/^\d*\.?\d{0,2}$/.test(v)) setPagesRead(v);
  };
  const onStoppedChange = (v: string) => {
    if (/^\d*$/.test(v)) setStoppedAt(v);
  };

  const summary = reading
    ? null
    : sabak
      ? `Memorizing ${portionSummary(juz, start, pages)}${mushafPage}`
      : portion === "Full"
        ? `Revising Juz ${juz} (full juz)`
        : portion === "Pages"
          ? `Revising ${portionSummary(juz, start, pages)}${mushafPage}`
          : `Revising Juz ${juz} · ${portion} ${part}`;
  const showStartHint =
    !reading && start == null && (sabak || portion === "Pages");

  const save = () => {
    // Last line of defence for a sheet opened before 3 AM and saved after:
    // keep it open (nothing typed is lost) rather than send an entry the
    // database will refuse.
    if (backdating && localHm(Date.now(), tz) >= BACKDATE_CUTOFF) {
      setCanBackdate(false);
      setWhen("today");
      setError("It’s past 3 AM, so yesterday is closed. Save it for today instead?");
      return;
    }
    // Backdate to 11:59 PM yesterday *in the profile's timezone* - every
    // consumer (streaks, daily bars, feed grouping) buckets by that zone, not
    // the device's. Late, because a backdate now only happens between
    // midnight and 3 AM for last night's session: it must sort after anything
    // already logged yesterday, or an earlier bookmark would win.
    const loggedAt = backdating ? zonedIso(yesterdayLocal(tz), 23, tz, 59) : null;
    if (reading) {
      const amt = Number(pagesRead);
      if (!pagesRead.trim() || Number.isNaN(amt) || amt <= 0) {
        setError("Enter how many pages you read.");
        return;
      }
      // Manual last page is optional, but if entered it must be a real page.
      if (!autoAdvance && stoppedAt.trim() && !readLoc) {
        setError(`Last page must be 1–${maxPage}, or leave it blank.`);
        return;
      }
      const loc = finalLoc;
      onSave({
        entry_type: initialType,
        from_ref: null,
        to_ref: loc ? String(loc.page) : null, // page; juz/surah derived
        amount: amt,
        unit: "page",
        juz: loc ? loc.juz : null,
        part: null,
        mushaf: mush,
        notes: notes.trim() || null,
        logged_at: loggedAt,
      });
    } else if (sabak) {
      onSave({
        entry_type: initialType,
        // Juz-relative start page ("3.5"), see src/lib/position.ts.
        from_ref: start != null ? serializeJuzPage(start) : null,
        to_ref: null,
        amount: pages,
        unit: "page",
        juz,
        part: null,
        mushaf: mush,
        notes: notes.trim() || null,
        logged_at: loggedAt,
      });
    } else {
      // revision: Full / Half / Quarter / Pages
      const isPages = portion === "Pages";
      onSave({
        entry_type: initialType,
        from_ref: isPages && start != null ? serializeJuzPage(start) : null,
        to_ref: null,
        amount: isPages ? pages : 1,
        unit: isPages ? "page" : PORTION_UNIT[portion],
        juz,
        part: portion === "Half" || portion === "Quarter" ? part : null,
        mushaf: mush,
        notes: notes.trim() || null,
        logged_at: loggedAt,
      });
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="log-sheet-title">
      <div className="px-5 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="log-sheet-title" className="text-title2">
            {editing ? "Edit" : "Log"} {meta.label}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-5 text-footnote text-muted">{meta.desc}</p>

        {reading ? (
          <div className="flex flex-col items-center gap-6 py-1">
            <div className="flex flex-col items-center gap-2">
              <FieldLabel className="!mb-0">Pages read</FieldLabel>
              <div className="flex items-center gap-2">
                <div className="w-28">
                  <Input
                    inputMode="decimal"
                    placeholder="0"
                    value={pagesRead}
                    onChange={(e) => onPagesReadChange(e.target.value)}
                    autoFocus
                    className="text-center text-title2 font-semibold"
                  />
                </div>
                <span className="text-callout text-muted">pages</span>
              </div>
            </div>
            <div className="w-full">
              {/* Auto-advance the bookmark: last page = previous + pages read.
                  Hidden while backdating - see `autoAdvance`. */}
              <div
                className={cn(
                  "flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1",
                  backdating && "hidden",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-callout font-semibold">
                    Continue from last page
                  </p>
                  <p className="text-footnote text-muted">
                    {autoPage
                      ? lastReadPage != null
                        ? `Adds your pages onto p.${lastReadPage}.`
                        : "Counts from the start of the Qur’an."
                      : "Enter the last page yourself."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoPage((v) => !v)}
                  aria-pressed={autoPage}
                  aria-label="Continue from last page"
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                    autoPage ? "bg-accent" : "bg-border",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all",
                      autoPage ? "left-[1.375rem]" : "left-0.5",
                    )}
                  />
                </button>
              </div>

              {autoAdvance ? (
                <div className="mt-3 flex h-9 items-center justify-center">
                  {finalLoc ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-accent-tint px-3.5 py-1.5 text-footnote font-medium text-accent">
                      Now on p.{finalLoc.page} · Juz {finalLoc.juz} ·{" "}
                      {finalLoc.surah.name}
                      <span dir="rtl" className="text-faint">
                        {finalLoc.surah.arabic}
                      </span>
                    </span>
                  ) : (
                    <span className="text-footnote text-faint">
                      Enter pages read to set your bookmark
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex flex-col items-center gap-2">
                  <FieldLabel className="!mb-0">
                    {backdating
                      ? "Last page you read yesterday (optional)"
                      : "Last page you read (optional)"}
                  </FieldLabel>
                  <div className="w-44">
                    <Input
                      inputMode="numeric"
                      placeholder={`1–${maxPage}`}
                      value={stoppedAt}
                      onChange={(e) => onStoppedChange(e.target.value)}
                      className="text-center"
                    />
                  </div>
                  <div className="flex h-9 items-center">
                    {readLoc ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-accent-tint px-3.5 py-1.5 text-footnote font-medium text-accent">
                        Juz {readLoc.juz} · {readLoc.surah.name}
                        <span dir="rtl" className="text-faint">
                          {readLoc.surah.arabic}
                        </span>
                      </span>
                    ) : stoppedAt ? (
                      <span className="text-footnote text-faint">
                        Enter a page from 1 to {maxPage}
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : sabak ? (
          <>
            <FieldLabel>What did you memorize?</FieldLabel>
            <div className="rounded-2xl bg-surface p-1.5 shadow-e1">
              <div className="mb-0.5 flex text-center text-caption font-medium uppercase tracking-wider text-faint">
                <div className="flex-1">Juz</div>
                <div className="flex-1">Starts at</div>
                <div className="flex-1">Pages</div>
              </div>
              <div className="flex">
                <div className="flex-1">
                  <WheelPicker options={JUZ} value={juz} onChange={onJuzChange} ariaLabel="Juz" />
                </div>
                <div className="flex-1">
                  <WheelPicker
                    options={startOptions}
                    value={startValue}
                    onChange={(l) => setStart(startFromLabel(l))}
                    ariaLabel="Starts at page of the juz"
                  />
                </div>
                <div className="flex-1">
                  <WheelPicker
                    options={SABAK_PAGES}
                    value={pages}
                    onChange={setPages}
                    ariaLabel="Pages"
                  />
                </div>
              </div>
            </div>
            <p className="mt-2 px-1 text-footnote text-accent">{summary}</p>
            {showStartHint && <StartHint />}
          </>
        ) : (
          <>
            <FieldLabel>What are you {verb}?</FieldLabel>
            <div className="rounded-2xl bg-surface p-1.5 shadow-e1">
              <div className="mb-0.5 flex text-center text-caption font-medium uppercase tracking-wider text-faint">
                <div className="flex-1">Juz</div>
                <div className="flex-1">Portion</div>
                {portion === "Pages" && <div className="flex-1">Starts at</div>}
                <div className="flex-1">
                  {portion === "Pages" ? "Pages" : "Part"}
                </div>
              </div>
              <div className="flex">
                <div className="flex-1">
                  <WheelPicker options={JUZ} value={juz} onChange={onJuzChange} ariaLabel="Juz" />
                </div>
                <div className="flex-1">
                  <WheelPicker
                    options={PORTIONS}
                    value={portion}
                    onChange={(p) => {
                      setPortion(p);
                      setPart(1);
                    }}
                    ariaLabel="Portion"
                  />
                </div>
                {portion === "Pages" && (
                  <div className="flex-1">
                    <WheelPicker
                      options={startOptions}
                      value={startValue}
                      onChange={(l) => setStart(startFromLabel(l))}
                      ariaLabel="Starts at page of the juz"
                    />
                  </div>
                )}
                <div className="flex-1">
                  {portion === "Full" ? (
                    <div className="grid h-[200px] place-items-center text-callout text-faint">
                      –
                    </div>
                  ) : portion === "Pages" ? (
                    <WheelPicker
                      options={REV_PAGES}
                      value={pages}
                      onChange={setPages}
                      ariaLabel="Pages"
                    />
                  ) : (
                    <WheelPicker
                      options={partOptions}
                      value={part}
                      onChange={setPart}
                      ariaLabel="Part"
                    />
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 px-1 text-footnote text-accent">{summary}</p>
            {showStartHint && <StartHint />}
          </>
        )}

        {/* When - backdate a forgotten entry to yesterday (new entries only,
            and only before 3 AM, so a missed day can't be patched later) */}
        {!editing && canBackdate && (
          <div className="mt-5">
            <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
              {(["today", "yesterday"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWhen(w)}
                  className={cn(
                    "flex-1 rounded-lg py-1.5 font-medium capitalize transition-colors",
                    when === w
                      ? "bg-surface text-foreground shadow-e1"
                      : "text-muted",
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
            {when === "yesterday" && (
              <p className="mt-1.5 px-1 text-footnote text-faint">
                Read last night and forgot to log? This saves it for yesterday.
                Open until 3 AM.
              </p>
            )}
          </div>
        )}

        {/* Notes - collapsed by default */}
        <div className="mt-5">
          {showNotes ? (
            <>
              <FieldLabel>Notes</FieldLabel>
              <Textarea
                placeholder="After Fajr, felt smooth…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                autoFocus
              />
            </>
          ) : (
            <button
              onClick={() => setShowNotes(true)}
              className="inline-flex items-center gap-1.5 text-subhead font-medium text-accent"
            >
              <Plus className="size-4" strokeWidth={2.5} /> Add a note
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-footnote text-danger">{error}</p>}

        <Button fullWidth className="mt-6" onClick={save}>
          {editing ? "Save changes" : "Save entry"}
        </Button>
      </div>
    </Sheet>
  );
}

/** Nudge toward giving a position, without making it mandatory. */
function StartHint() {
  return (
    <p className="mt-1 px-1 text-footnote text-faint">
      Set “Starts at” to keep your place in the juz. 3½ means the second half of
      page 3.
    </p>
  );
}
