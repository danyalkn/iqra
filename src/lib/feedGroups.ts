/**
 * Feed grouping - pure, node-testable, no React.
 *
 * A busy day used to be five separate cards (sabak, sabak para, two dhor,
 * reading). The feed now shows ONE card per person per day, with one line
 * per entry type; several entries of the same type merge into that line:
 *
 *   Dhor     Juz 1 · Q1, Q2
 *   Sabak    Juz 3 · p.4, 1st half
 *   Reading  12 pages · Juz 18 · Al-Mu'minun
 *
 * The individual entries stay available underneath (expand on the card).
 */

import type { EntryType } from "@/lib/entries";
import { bookmarkLabel, pageFromRef, DEFAULT_MUSHAF } from "@/lib/mushaf";
import { describeEntry } from "@/lib/format";
import {
  pagesPhrase,
  positionLabel,
  positionSaysAmount,
  rowJuzPage,
} from "@/lib/position";
import { localDate } from "@/lib/dates";
import type { LogRow } from "@/lib/types";

/** Line order inside a card: newest material first, then reading. */
const TYPE_ORDER: EntryType[] = ["sabak", "sabak_para", "dor", "reading", "revising"];

export type FeedLine = { type: EntryType; text: string; count: number };

export type FeedCard = {
  user_id: string;
  /** This person's entries that day, newest first. */
  entries: LogRow[];
  /** Newest entry time (ISO), for ordering and the time label. */
  latestAt: string;
  /** Page-equivalent total for the day (ayah-only entries add nothing). */
  pages: number;
  lines: FeedLine[];
};

export type FeedDay = { ymd: string; cards: FeedCard[] };

const byNewest = (a: LogRow, b: LogRow) =>
  new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime();

/** One type's entries (any order) → one line of text. */
export function mergeLine(type: EntryType, rows: LogRow[]): string {
  const oldestFirst = [...rows].sort((a, b) => -byNewest(a, b));

  if (type === "reading" || type === "revising") {
    let pages = 0;
    let bookmark: LogRow | null = null;
    for (const r of oldestFirst) {
      if (r.unit === "page" && r.amount != null) pages += +r.amount;
      else if (r.pages_equiv) pages += +r.pages_equiv;
      if (pageFromRef(r.to_ref) != null) bookmark = r; // latest wins
    }
    const parts: string[] = [];
    if (pages > 0) parts.push(pagesPhrase(+pages.toFixed(2)));
    if (bookmark) {
      parts.push(
        bookmarkLabel(bookmark.mushaf ?? DEFAULT_MUSHAF, pageFromRef(bookmark.to_ref)!),
      );
    }
    return parts.length ? parts.join(" · ") : describeEntry(oldestFirst[0]);
  }

  // Hifz: one segment per juz, in the order the juz were first logged.
  const juzOrder: number[] = [];
  const byJuz = new Map<number, { pieces: string[]; loosePages: number }>();
  const other: string[] = []; // legacy rows without a juz
  for (const r of oldestFirst) {
    if (r.juz == null) {
      other.push(describeEntry(r));
      continue;
    }
    let g = byJuz.get(r.juz);
    if (!g) {
      g = { pieces: [], loosePages: 0 };
      byJuz.set(r.juz, g);
      juzOrder.push(r.juz);
    }
    const start = rowJuzPage(r);
    const amount = r.amount != null ? +r.amount : 0;
    if (start != null) {
      const label = positionLabel(start, amount);
      g.pieces.push(
        positionSaysAmount(start, amount) ? label : `${label} (${pagesPhrase(amount)})`,
      );
    } else if (r.unit === "page") {
      g.loosePages += amount;
    } else if (r.unit === "quarter" && r.part) {
      g.pieces.push(`Q${r.part}`);
    } else if (r.unit === "hizb" && r.part) {
      g.pieces.push(`Half ${r.part}`);
    } else if (r.unit === "juz") {
      g.pieces.push("full juz");
    } else {
      g.pieces.push(describeEntry(r).replace(/^Juz \d+ · /, ""));
    }
  }
  const segments = juzOrder.map((j) => {
    const g = byJuz.get(j)!;
    const pieces = [...g.pieces];
    if (g.loosePages > 0) pieces.push(pagesPhrase(+g.loosePages.toFixed(2)));
    const unique = pieces.filter((p, i) => pieces.indexOf(p) === i);
    return unique.length ? `Juz ${j} · ${unique.join(", ")}` : `Juz ${j}`;
  });
  return [...segments, ...other].join("; ");
}

/** Entries (any order) → days, newest first → one card per person. */
export function groupFeed(entries: LogRow[], tz: string): FeedDay[] {
  const days = new Map<string, Map<string, LogRow[]>>();
  for (const e of entries) {
    const ymd = localDate(e.logged_at, tz);
    let people = days.get(ymd);
    if (!people) {
      people = new Map();
      days.set(ymd, people);
    }
    const list = people.get(e.user_id);
    if (list) list.push(e);
    else people.set(e.user_id, [e]);
  }

  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([ymd, people]) => {
      const cards: FeedCard[] = [...people.entries()].map(([user_id, rows]) => {
        const sorted = [...rows].sort(byNewest);
        const byType = new Map<EntryType, LogRow[]>();
        for (const r of sorted) {
          const list = byType.get(r.entry_type);
          if (list) list.push(r);
          else byType.set(r.entry_type, [r]);
        }
        const lines = TYPE_ORDER.filter((t) => byType.has(t)).map((t) => ({
          type: t,
          text: mergeLine(t, byType.get(t)!),
          count: byType.get(t)!.length,
        }));
        const pages = sorted.reduce(
          (s, r) => s + (r.pages_equiv ? +r.pages_equiv : 0),
          0,
        );
        return {
          user_id,
          entries: sorted,
          latestAt: sorted[0].logged_at,
          pages: +pages.toFixed(2),
          lines,
        };
      });
      cards.sort(
        (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
      );
      return { ymd, cards };
    });
}
