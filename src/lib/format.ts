import { ENTRY_META, UNIT_META, isReadingType } from "@/lib/entries";
import { bookmarkLabel, pageFromRef, DEFAULT_MUSHAF } from "@/lib/mushaf";
import {
  pagesPhrase,
  positionLabel,
  positionSaysAmount,
  rowJuzPage,
} from "@/lib/position";
import type { LogRow } from "@/lib/types";

/** Primary label for an entry (what was covered). */
export function describeEntry(e: LogRow): string {
  // Reading/revising: a bookmark derived from the last page read, in the
  // mushaf the entry was logged in (so it reads right for everyone).
  if (isReadingType(e.entry_type)) {
    const page = pageFromRef(e.to_ref);
    if (page != null) return bookmarkLabel(e.mushaf ?? DEFAULT_MUSHAF, page);
    return ENTRY_META[e.entry_type].label;
  }
  // Structured hifz entry (juz + portion, plus where in the juz when known).
  if (e.juz != null) {
    const base = `Juz ${e.juz}`;
    const start = rowJuzPage(e);
    if (start != null) return `${base} · ${positionLabel(start, e.amount)}`;
    if (e.unit === "hizb" && e.part) return `${base} · Half ${e.part}`;
    if (e.unit === "quarter" && e.part) return `${base} · Q${e.part}`;
    return base; // full juz
  }
  if (e.from_ref && e.to_ref) return `${e.from_ref} → ${e.to_ref}`;
  return e.from_ref || e.to_ref || ENTRY_META[e.entry_type].label;
}

/** Secondary quantity label (null when the portion already says it). */
export function quantityLabel(e: LogRow): string | null {
  // Reading: pages read + where they stopped ("12 pages · p.262").
  if (isReadingType(e.entry_type)) {
    const parts: string[] = [];
    if (e.amount != null) {
      const n = +e.amount;
      parts.push(`${n} ${n === 1 ? "page" : "pages"}`);
    }
    const page = pageFromRef(e.to_ref);
    if (page != null) parts.push(`p.${page}`);
    return parts.length ? parts.join(" · ") : null;
  }
  // Structured hifz: only show a quantity when it's a page amount (sabak or a
  // "Pages" revision). Full/Half/Quarter already read in describeEntry.
  if (e.juz != null) {
    if (e.unit === "page" && e.amount != null) {
      const start = rowJuzPage(e);
      if (start != null && positionSaysAmount(start, +e.amount)) return null;
      return pagesPhrase(+e.amount);
    }
    return null;
  }
  if (e.amount == null || e.unit == null) return null;
  const n = +e.amount;
  const word = n === 1 ? UNIT_META[e.unit].one : UNIT_META[e.unit].plural;
  let s = `${n} ${word}`;
  if (e.pages_equiv != null && e.unit !== "page") {
    s += ` · ≈ ${+(+e.pages_equiv).toFixed(2)} pg`;
  }
  return s;
}
