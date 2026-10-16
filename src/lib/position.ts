/**
 * Where inside a juz a hifz entry sits ("the second half of page 3 of
 * Juz 3"). Pure module: no React, no I/O.
 *
 * Storage: structured hifz rows already carry `juz` + `amount` (pages).
 * The start of the portion is stored in `from_ref` as the JUZ-RELATIVE page
 * the portion begins on, in quarter-page steps: "3" = top of the 3rd page of
 * the juz, "3.5" = its second half, "3.25" = its second quarter. `from_ref` is the schema's free-text
 * "what was covered" column; hifz rows never used it (the log form always
 * wrote null), and reading rows keep their bookmark in `to_ref`, so no
 * migration is needed and old rows simply read as "no position".
 *
 * Juz-relative, not absolute, because that is how memorizers count ("3rd
 * page of the 3rd juz"). The absolute mushaf page is derived with the
 * entry's mushaf when a chart needs it.
 */

import {
  juzStartPages,
  totalPages,
  DEFAULT_MUSHAF,
  type MushafId,
} from "@/lib/mushaf";
import type { EntryType } from "@/lib/entries";

/** Hifz types that carry a juz (+ optional in-juz position). */
export function isHifzType(t: EntryType): boolean {
  return t === "sabak" || t === "sabak_para" || t === "dor";
}

/** Pages in a juz for a mushaf (Uthmani juz 1 = 21, juz 30 = 23, most 20). */
export function juzLength(m: MushafId | null | undefined, juz: number): number {
  const mm = m ?? DEFAULT_MUSHAF;
  const starts = juzStartPages(mm);
  const j = Math.min(30, Math.max(1, Math.round(juz)));
  const end = j < 30 ? starts[j] - 1 : totalPages(mm);
  return end - starts[j - 1] + 1;
}

/** Snap to the nearest quarter page. */
export const toQuarter = (n: number) => Math.round(n * 4) / 4;

/** Parse a stored juz-relative start ("3", "3.5", "3.25"). Anything else =
 *  no position. */
export function parseJuzPage(ref: string | null | undefined): number | null {
  if (!ref || !/^\d{1,2}(\.(25|5|75))?$/.test(ref)) return null;
  const n = Number(ref);
  return n >= 1 ? n : null;
}

/** Serialize a juz-relative start for `from_ref`. */
export function serializeJuzPage(n: number): string {
  return String(toQuarter(n));
}

const FRACTION: Record<string, string> = { "0.25": "¼", "0.5": "½", "0.75": "¾" };

/** Wheel label for a start: 3 → "3", 3.5 → "3½", 3.25 → "3¼". */
export function juzPageLabel(n: number): string {
  const whole = Math.floor(n);
  return `${whole}${FRACTION[String(toQuarter(n - whole))] ?? ""}`;
}

/** Parse a wheel label back ("3½" → 3.5). */
export function juzPageFromLabel(label: string): number | null {
  const m = label.match(/^(\d+)([¼½¾]?)$/);
  if (!m) return null;
  return Number(m[1]) + (m[2] === "¼" ? 0.25 : m[2] === "½" ? 0.5 : m[2] === "¾" ? 0.75 : 0);
}

/** Every start a juz offers: [1, 1.5, …, len + 0.5] in half-page steps, or
 *  [1, 1.25, …, len + 0.75] in quarter steps. */
export function juzPageOptions(
  m: MushafId | null | undefined,
  juz: number,
  step: 0.5 | 0.25 = 0.5,
): number[] {
  const len = juzLength(m, juz);
  const out: number[] = [];
  for (let p = 1; p <= len + 1 - step + 1e-9; p += step) out.push(toQuarter(p));
  return out;
}

/** True when a start or amount needs quarter steps to be represented. */
export function needsQuarters(...values: (number | null | undefined)[]): boolean {
  return values.some((v) => v != null && toQuarter(+v * 2) % 1 !== 0);
}

/** Absolute mushaf page a juz-relative position falls on. */
export function absolutePage(
  m: MushafId | null | undefined,
  juz: number,
  juzPage: number,
): number {
  const mm = m ?? DEFAULT_MUSHAF;
  return juzStartPages(mm)[Math.min(30, Math.max(1, juz)) - 1] + Math.floor(juzPage) - 1;
}

/** "½" / "¼" / "1½" / "3" - page amounts the way people say them. */
export function pagesAmountLabel(n: number): string {
  const whole = Math.floor(n);
  const frac = +(n - whole).toFixed(2);
  const glyph = frac === 0.25 ? "¼" : frac === 0.5 ? "½" : frac === 0.75 ? "¾" : "";
  if (glyph) return whole === 0 ? glyph : `${whole}${glyph}`;
  return String(+n.toFixed(2));
}

/** "½ page", "1 page", "2½ pages". */
export function pagesPhrase(n: number): string {
  return `${pagesAmountLabel(n)} ${n > 0 && n <= 1 ? "page" : "pages"}`;
}

const ORDINAL = ["1st", "2nd", "3rd", "4th"];

/** Which shape of label a (start, amount) pair gets - see positionLabel. */
function labelKind(start: number, a: number): "half" | "quarter" | "pages" | "from" {
  const frac = toQuarter(start - Math.floor(start));
  if (a === 0.5 && (frac === 0 || frac === 0.5)) return "half";
  if (a === 0.25) return "quarter";
  if (frac === 0 && Number.isInteger(a) && a >= 1) return "pages";
  return "from";
}

/**
 * Human label for a portion inside a juz:
 *   start 3,    ½ page  → "p.3, 1st half"
 *   start 3.5,  ½ page  → "p.3, 2nd half"
 *   start 3.25, ¼ page  → "p.3, 2nd quarter"
 *   start 4,    1 page  → "p.4"
 *   start 1,    3 pages → "p.1–3"
 *   anything else       → "from p.3½" (the amount is shown alongside)
 */
export function positionLabel(start: number, amount: number | null | undefined): string {
  const a = amount == null ? 0 : +amount;
  const whole = Math.floor(start);
  const frac = toQuarter(start - whole);
  switch (labelKind(start, a)) {
    case "half":
      return `p.${whole}, ${frac === 0 ? "1st" : "2nd"} half`;
    case "quarter":
      return `p.${whole}, ${ORDINAL[frac * 4]} quarter`;
    case "pages":
      return a === 1 ? `p.${whole}` : `p.${whole}–${whole + a - 1}`;
    default:
      return `from p.${juzPageLabel(start)}`;
  }
}

/** True when `positionLabel` already says how much (don't repeat it). */
export function positionSaysAmount(start: number, amount: number | null | undefined): boolean {
  return labelKind(start, amount == null ? 0 : +amount) !== "from";
}

/** Minimal row shape the position helpers read. */
export type PositionedRow = {
  entry_type: EntryType;
  juz: number | null;
  unit: string | null;
  amount: number | null;
  from_ref: string | null;
  mushaf?: MushafId | null;
};

/** The in-juz start of a hifz row, or null (old rows, non-page portions). */
export function rowJuzPage(e: PositionedRow): number | null {
  if (!isHifzType(e.entry_type) || e.juz == null || e.unit !== "page") return null;
  return parseJuzPage(e.from_ref);
}

/**
 * Where the next sabak should start, continuing from the last one: same juz,
 * exactly where the last portion ended (quarter-page precision, so it never
 * runs ahead of what was memorized). Once the whole last page is done it
 * rolls to the start of the next juz. Null when the last sabak had no
 * position to continue from, or finished Juz 30.
 */
export function nextSabakStart(
  last: PositionedRow | null | undefined,
  m: MushafId | null | undefined,
): { juz: number; start: number } | null {
  if (!last || last.juz == null) return null;
  const start = rowJuzPage(last);
  if (start == null) return null;
  const next = toQuarter(start + (last.amount ? +last.amount : 0));
  // Starts run up to the last quarter of the last page (len + 0.75).
  if (next >= juzLength(m, last.juz) + 1) {
    return last.juz < 30 ? { juz: last.juz + 1, start: 1 } : null;
  }
  return { juz: last.juz, start: next };
}
