/**
 * The hifz revision plan: which juz a memorizer should revise today, and
 * which ones will be due on each of the coming days if nothing more is
 * logged (docs/DECISIONS.md "Revision plan (owner, 2026-10-17)", the
 * contract for every rule below).
 *
 * - A revision of a juz is any Sabak Para or Dhor entry with that `juz`.
 *   A partial juz (one hizb, a quarter, a few pages) counts as revising it.
 * - Current juz: the juz of the latest Sabak entry.
 * - Previous juz: the juz of the most recent Sabak in a different juz;
 *   failing that, current - 1 when the member has any hifz entry (Sabak,
 *   Sabak Para or Dhor) in it.
 * - Older juz: every other juz the member has a Sabak, Sabak Para or Dhor
 *   entry in.
 * - Intervals: current every 2 days (Sabak Para), previous every 3 days
 *   (Sabak Para), each older juz every 7 days (Dhor). A juz is due when the
 *   days since its last revision, counted in profile-local calendar dates,
 *   reach its interval. Never revised means due.
 * - Due items are listed current first, then previous, then older juz by
 *   most overdue.
 *
 * Only the entries passed in are seen, so callers pass the member's whole
 * hifz history (src/data/entryReads fetchMyHifzHistory, small: three entry
 * types, a few hundred rows at most). With that, a juz the member touched
 * long ago still counts as older and stays due, and "Not revised yet" means
 * exactly that. Given a shorter window instead, a juz with no entry in it
 * drops out of the plan.
 *
 * Pure: no React, no react-native, no expo. Native-only shared-lib file (the
 * web app has no revision plan).
 */

import { localDate, nextYmd } from "./dates";
import type { EntryType } from "./entries";
import type { LogRow } from "./types";

export type RevisionRole = "current" | "previous" | "older";

/** Days between revisions: the current juz every other day. */
export const CURRENT_INTERVAL = 2;
/** Days between revisions: the previous juz never three days without. */
export const PREVIOUS_INTERVAL = 3;
/** Days between revisions: each older juz once a week. */
export const OLDER_INTERVAL = 7;

export const REVISION_INTERVAL: Record<RevisionRole, number> = {
  current: CURRENT_INTERVAL,
  previous: PREVIOUS_INTERVAL,
  older: OLDER_INTERVAL,
};

/** The entry type each role is revised with. */
export const REVISION_TYPE: Record<RevisionRole, Extract<EntryType, "sabak_para" | "dor">> = {
  current: "sabak_para",
  previous: "sabak_para",
  older: "dor",
};

/** How often, in words, for the reason line under each row. */
export const REVISION_CADENCE: Record<RevisionRole, string> = {
  current: "every other day",
  previous: "every 3 days",
  older: "once a week",
};

/** The fields the plan reads; a full LogRow fits. */
export type RevisionEntry = Pick<LogRow, "entry_type" | "juz" | "logged_at">;

export type RevisionItem = {
  juz: number;
  role: RevisionRole;
  /** The entry type to log for it: Sabak Para for current / previous,
   *  Dhor for older juz. */
  type: Extract<EntryType, "sabak_para" | "dor">;
  interval: number;
  /** Profile-local date (YYYY-MM-DD) of the latest revision, null = never. */
  lastRevised: string | null;
  /** Days from lastRevised to the plan's day, null = never revised. */
  daysSince: number | null;
  due: boolean;
};

const HIFZ_TYPES: ReadonlySet<EntryType> = new Set(["sabak", "sabak_para", "dor"]);
const REVISION_TYPES: ReadonlySet<EntryType> = new Set(["sabak_para", "dor"]);

function validJuz(j: number | null): j is number {
  return j != null && Number.isInteger(j) && j >= 1 && j <= 30;
}

/** Whole calendar days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const ms = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** The item as it stands on `day`, assuming no revision after lastRevised. */
function itemOn(
  juz: number,
  role: RevisionRole,
  lastRevised: string | null,
  day: string,
): RevisionItem {
  const interval = REVISION_INTERVAL[role];
  // A revision stamped later than `day` (clock skew) counts as today's.
  const daysSince = lastRevised == null ? null : Math.max(0, daysBetween(lastRevised, day));
  return {
    juz,
    role,
    type: REVISION_TYPE[role],
    interval,
    lastRevised,
    daysSince,
    due: daysSince == null || daysSince >= interval,
  };
}

const ROLE_ORDER: Record<RevisionRole, number> = { current: 0, previous: 1, older: 2 };

/** Days past due (never revised sorts as the most overdue). */
function overdue(item: RevisionItem): number {
  return item.daysSince == null ? Infinity : item.daysSince - item.interval;
}

/** Current first, then previous, then older juz by most overdue (ties by
 *  juz number, so the order is stable). */
export function orderRevisions(items: RevisionItem[]): RevisionItem[] {
  return [...items].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      (a.role === "older" ? overdue(b) - overdue(a) : 0) ||
      a.juz - b.juz,
  );
}

/**
 * Every juz the plan tracks, as it stands on `today` (profile-local
 * YYYY-MM-DD), ordered as the card lists them. Filter on `due` for the
 * card, or pass the result to `dueOn` for a later day.
 */
export function revisionPlan(
  entries: RevisionEntry[],
  tz: string,
  today: string,
): RevisionItem[] {
  let latestSabak: RevisionEntry | null = null;
  const hifzJuz = new Set<number>();
  const lastRevised = new Map<number, string>();

  for (const e of entries) {
    if (!HIFZ_TYPES.has(e.entry_type) || !validJuz(e.juz)) continue;
    hifzJuz.add(e.juz);
    if (e.entry_type === "sabak") {
      if (!latestSabak || new Date(e.logged_at) > new Date(latestSabak.logged_at)) latestSabak = e;
    }
    if (REVISION_TYPES.has(e.entry_type)) {
      const d = localDate(e.logged_at, tz);
      const cur = lastRevised.get(e.juz);
      if (!cur || d > cur) lastRevised.set(e.juz, d);
    }
  }

  const current = latestSabak?.juz ?? null;
  let previous: number | null = null;
  if (current != null) {
    let best: RevisionEntry | null = null;
    for (const e of entries) {
      if (e.entry_type !== "sabak" || !validJuz(e.juz) || e.juz === current) continue;
      if (!best || new Date(e.logged_at) > new Date(best.logged_at)) best = e;
    }
    previous = best?.juz ?? (current > 1 && hifzJuz.has(current - 1) ? current - 1 : null);
  }

  const items: RevisionItem[] = [];
  for (const juz of hifzJuz) {
    const role: RevisionRole =
      juz === current ? "current" : juz === previous ? "previous" : "older";
    items.push(itemOn(juz, role, lastRevised.get(juz) ?? null, today));
  }
  // Current and previous both come from hifz entries, so the loop above
  // always reaches them.
  return orderRevisions(items);
}

/** What is due today, in card order. */
export function dueToday(plan: RevisionItem[]): RevisionItem[] {
  return plan.filter((i) => i.due);
}

/**
 * What will be due on `day` (YYYY-MM-DD, on or after the plan's day)
 * assuming no further revisions are logged: the projection the week-ahead
 * evening nudges are scheduled from.
 */
export function dueOn(plan: RevisionItem[], day: string): RevisionItem[] {
  return orderRevisions(
    plan.map((i) => itemOn(i.juz, i.role, i.lastRevised, day)).filter((i) => i.due),
  );
}

/** `days` consecutive local dates starting at `from`, each with what will be
 *  due then (empty days included, so callers can tell them apart). */
export function dueAhead(
  plan: RevisionItem[],
  from: string,
  days: number,
): { day: string; due: RevisionItem[] }[] {
  const out: { day: string; due: RevisionItem[] }[] = [];
  let day = from;
  for (let i = 0; i < days; i++) {
    out.push({ day, due: dueOn(plan, day) });
    day = nextYmd(day);
  }
  return out;
}

/** The plain reason line under a row: "Last revised 2 days ago · every
 *  other day", or "Not revised yet". */
export function revisionReason(item: RevisionItem): string {
  if (item.daysSince == null) return "Not revised yet";
  const ago =
    item.daysSince === 0
      ? "today"
      : item.daysSince === 1
        ? "yesterday"
        : `${item.daysSince} days ago`;
  return `Last revised ${ago} · ${REVISION_CADENCE[item.role]}`;
}

/**
 * The plan's input from two reads: the member's whole hifz history and the
 * live, windowed entries a screen holds. Rows newer than `cutoff` (ISO) come
 * only from the windowed list, so an edit, a delete or an optimistic insert
 * there counts at once; older rows come from the history. Ids dedupe the
 * overlap. Pick a cutoff inside the window (Today uses a day inside it).
 */
export function mergeRevisionEntries(
  windowed: (RevisionEntry & { id: string })[],
  history: (RevisionEntry & { id: string })[],
  cutoff: string,
): RevisionEntry[] {
  const ids = new Set(windowed.map((e) => e.id));
  const cut = new Date(cutoff).getTime();
  const out: RevisionEntry[] = [...windowed];
  for (const h of history) {
    if (!ids.has(h.id) && new Date(h.logged_at).getTime() < cut) out.push(h);
  }
  return out;
}
