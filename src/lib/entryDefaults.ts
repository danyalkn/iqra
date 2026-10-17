/**
 * What a fresh log entry looks like before the member touches anything:
 * the "carry on from the last one" defaults the log sheet opens with, and
 * the row those defaults produce when saved as-is. Pulled out of the sheet
 * so the notification actions (Phase 3: "Log 1 page" on a reminder) write
 * exactly the entry the sheet would have saved with one tap.
 *
 * Pure: no React, no DOM, no react-native. Native-first file (not yet in
 * the web repo); the web LogSheet carries the same rules inline.
 */

import { isReadingType, type EntryType, type Unit } from "./entries";
import { clampPage, locatePage, pageFromRef, type MushafId } from "./mushaf";
import { nextSabakStart, rowJuzPage, serializeJuzPage } from "./position";
import type { LogRow, NewEntry } from "./types";

export type Portion = "Full" | "Half" | "Quarter" | "Pages";
export const PORTIONS: Portion[] = ["Full", "Half", "Quarter", "Pages"];

// Sabak (new memorization) is never more than a quarter (~5 pages) at a time.
export const SABAK_PAGES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5];
// Revision can cover more.
export const REV_PAGES = [
  0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20,
];

export const PORTION_UNIT: Record<Exclude<Portion, "Pages">, Unit> = {
  Full: "juz",
  Half: "hizb",
  Quarter: "quarter",
};

export function defaultPortion(t: EntryType): Portion {
  return t === "dor" ? "Full" : "Quarter";
}

/** Reconstruct the portion wheel from a saved revision entry's unit. */
export function portionFromUnit(unit: Unit | null): Portion {
  if (unit === "juz") return "Full";
  if (unit === "hizb") return "Half";
  if (unit === "quarter") return "Quarter";
  return "Pages";
}

/** The hifz wheels: juz, portion, part (half / quarter number), pages and
 *  the in-juz start page (half or quarter steps, null = not specified). */
export type HifzDefaults = {
  juz: number;
  portion: Portion;
  part: number;
  pages: number;
  start: number | null;
};

/**
 * Fresh hifz entry defaults: carry on from the last entry of this type, so
 * tomorrow's sabak is usually one tap. Sabak continues right after the last
 * portion; revisions reuse the last juz and rotate halves / quarters.
 */
export function freshHifzDefaults(
  type: EntryType,
  last: LogRow | null | undefined,
  m: MushafId,
): HifzDefaults {
  const base: HifzDefaults = {
    juz: 1,
    portion: defaultPortion(type),
    part: 1,
    pages: 1,
    start: null,
  };
  if (type === "sabak") {
    const next = nextSabakStart(last, m);
    const amt = last?.amount != null ? +last.amount : 1;
    return {
      ...base,
      juz: next?.juz ?? last?.juz ?? 1,
      start: next?.start ?? null,
      pages: SABAK_PAGES.includes(amt) ? amt : 1,
    };
  }
  if (last) {
    const p = portionFromUnit(last.unit);
    // Quarters and halves usually rotate: suggest the next one.
    const max = p === "Half" ? 2 : p === "Quarter" ? 4 : 1;
    const amt = last.amount != null ? +last.amount : 1;
    return {
      juz: last.juz ?? 1,
      portion: p,
      part: last.part ? (last.part % max) + 1 : 1,
      pages: p === "Pages" && REV_PAGES.includes(amt) ? amt : 1,
      start: rowJuzPage(last),
    };
  }
  return base;
}

/** The row a hifz form with these wheel values saves (notes and backdating
 *  are added by the caller). */
export function hifzEntry(type: EntryType, d: HifzDefaults, mush: MushafId): NewEntry {
  if (type === "sabak") {
    return {
      entry_type: type,
      // Juz-relative start page ("3.5"), see position.ts.
      from_ref: d.start != null ? serializeJuzPage(d.start) : null,
      to_ref: null,
      amount: d.pages,
      unit: "page",
      juz: d.juz,
      part: null,
      mushaf: mush,
      notes: null,
      logged_at: null,
    };
  }
  // revision: Full / Half / Quarter / Pages
  const isPages = d.portion === "Pages";
  return {
    entry_type: type,
    from_ref: isPages && d.start != null ? serializeJuzPage(d.start) : null,
    to_ref: null,
    amount: isPages ? d.pages : 1,
    unit: d.portion === "Pages" ? "page" : PORTION_UNIT[d.portion],
    juz: d.juz,
    part: d.portion === "Half" || d.portion === "Quarter" ? d.part : null,
    mushaf: mush,
    notes: null,
    logged_at: null,
  };
}

/** A reading of `amount` pages with the bookmark auto-advanced from the
 *  previous last page (the sheet's default), located in the reader's mushaf. */
export function readingEntry(
  type: EntryType,
  amount: number,
  lastReadPage: number | null,
  mush: MushafId,
): NewEntry {
  const page = clampPage(mush, Math.round((lastReadPage ?? 0) + amount));
  const loc = locatePage(mush, page);
  return {
    entry_type: type,
    from_ref: null,
    to_ref: String(loc.page), // page; juz/surah derived
    amount,
    unit: "page",
    juz: loc.juz,
    part: null,
    mushaf: mush,
    notes: null,
    logged_at: null,
  };
}

/** The newest entry of `type` by logged_at (array order is not trusted: a
 *  backdated row can sit at the head). */
export function newestOfType(entries: LogRow[], type: EntryType): LogRow | null {
  let best: LogRow | null = null;
  for (const x of entries) {
    if (x.entry_type !== type) continue;
    if (!best || new Date(x.logged_at) > new Date(best.logged_at)) best = x;
  }
  return best;
}

/** The most recent reading bookmark (last page read), by logged_at. */
export function lastReadPageOf(entries: LogRow[]): number | null {
  let best: LogRow | null = null;
  for (const x of entries) {
    if (!isReadingType(x.entry_type) || !x.to_ref) continue;
    if (!best || new Date(x.logged_at) > new Date(best.logged_at)) best = x;
  }
  return best ? pageFromRef(best.to_ref) : null;
}

/**
 * The entry a one-tap log produces: what the sheet would save for `type`
 * with its defaults, given the member's recent entries. `amount` overrides
 * the pages for a reading; hifz actions carry no amount and reuse the last
 * one. Readings with no bookmark yet start the count from page 0, as the
 * sheet's auto-advance does.
 */
export function continuedEntry(
  type: EntryType,
  recent: LogRow[],
  mush: MushafId,
  amount: number | null,
): NewEntry {
  if (isReadingType(type)) {
    const last = newestOfType(recent, type);
    const amt = amount ?? (last?.amount != null ? +last.amount : 1);
    return readingEntry(type, amt, lastReadPageOf(recent), mush);
  }
  return hifzEntry(type, freshHifzDefaults(type, newestOfType(recent, type), mush), mush);
}

/** A page count typed into a notification's text field (or carried in a
 *  deep link): up to two decimals, more than 0, at most 100. Null otherwise. */
export function parseLogAmount(text: string | null | undefined): number | null {
  if (text == null) return null;
  const s = text.trim();
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}
