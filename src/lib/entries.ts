/**
 * Single source of truth for entry types, units, buckets, and the page
 * rollup. Mirrors the DB: entry_type CHECK list, unit CHECK list, and the
 * pages_equiv generated column (page×1, quarter×5, hizb×10, juz×20; ayah→null).
 */

export type Mode = "hifz" | "reading";

export type EntryType =
  | "sabak"
  | "sabak_para"
  | "dor"
  | "reading"
  | "revising";

export type Bucket = "new" | "revision";

export const ENTRY_META: Record<
  EntryType,
  { label: string; bucket: Bucket; desc: string }
> = {
  sabak: {
    label: "Sabak",
    bucket: "new",
    desc: "New lesson: the fresh portion you’re memorizing today.",
  },
  sabak_para: {
    label: "Sabak Para",
    bucket: "revision",
    desc: "Recent revision: what you learnt in the last week or two.",
  },
  dor: {
    label: "Dhor",
    bucket: "revision",
    desc: "Old review (manzil): long-term revision of older juz.",
  },
  reading: {
    label: "Reading",
    bucket: "new",
    desc: "Reading the Quran cover to cover.",
  },
  revising: {
    label: "Revising",
    bucket: "revision",
    desc: "Re-reading sections you’ve already read.",
  },
};

/** Entry types offered per mode (drives the + speed-dial). Memorizers can also
 *  log plain reading; readers only see reading/revising. */
export const TYPES_BY_MODE: Record<Mode, EntryType[]> = {
  hifz: ["sabak", "sabak_para", "dor", "reading"],
  reading: ["reading"],
};

export function bucketOf(type: EntryType): Bucket {
  return ENTRY_META[type].bucket;
}

// ── Units ──────────────────────────────────────────────────────────────────

export type Unit = "page" | "quarter" | "hizb" | "juz" | "ayah";

/** Pages per unit (Madani 604-page mushaf). null = not page-convertible. */
export const PAGES_PER_UNIT: Record<Unit, number | null> = {
  page: 1,
  quarter: 5,
  hizb: 10,
  juz: 20,
  ayah: null,
};

export const UNIT_META: Record<
  Unit,
  { label: string; one: string; plural: string }
> = {
  page: { label: "Pages", one: "page", plural: "pages" },
  quarter: { label: "Quarter", one: "quarter", plural: "quarters" },
  hizb: { label: "Hizb", one: "hizb", plural: "hizb" },
  juz: { label: "Juz", one: "juz", plural: "juz" },
  ayah: { label: "Ayahs", one: "ayah", plural: "ayahs" },
};

/** Order of unit chips in the log form. */
export const UNIT_ORDER: Unit[] = ["page", "quarter", "hizb", "juz", "ayah"];

/** Smart default unit per entry type (overridable per entry). */
export const DEFAULT_UNIT: Record<EntryType, Unit> = {
  sabak: "page",
  sabak_para: "quarter",
  dor: "juz",
  reading: "page",
  revising: "page",
};

/** Reading-style types use a "stopped at page" bookmark instead of a ref. */
export function isReadingType(type: EntryType): boolean {
  return type === "reading" || type === "revising";
}

/** amount in `unit` → pages equivalent (null for ayah / unknown). */
export function pagesEquiv(
  amount: number | null | undefined,
  unit: Unit | null | undefined,
): number | null {
  if (amount == null || unit == null) return null;
  const per = PAGES_PER_UNIT[unit];
  return per == null ? null : amount * per;
}
