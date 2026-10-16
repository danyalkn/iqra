"use client";

import { useMemo, useState } from "react";
import { ChevronRight, History, UtensilsCrossed } from "lucide-react";
import { shortDate } from "@/lib/dates";
import {
  KHATMAH_PAGES,
  khatmahPosition,
  recentPace,
  splitKhatmahs,
  type KhatmahRow,
  type KhatmahSegment,
} from "@/lib/khatmah";
import { surahForPage } from "@/lib/mushaf";
import { cn } from "@/lib/cn";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";

const fmt1 = (n: number) => String(+n.toFixed(1));

/** "7 Jun", or "7 Jun 2025" outside the current year. */
function dateLabel(ymd: string, today: string): string {
  const base = shortDate(ymd);
  return ymd.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${ymd.slice(0, 4)}`;
}

const dayWord = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The circle's khatmah: which one we're on, how many juz of it are done,
 * the page we've reached, and (in a sheet) how long each past one took.
 * Every member's page-bearing entry counts, measured on the Uthmani mushaf.
 */
export function KhatmahCard({
  rows,
  tz,
  today,
}: {
  rows: KhatmahRow[];
  tz: string;
  today: string;
}) {
  const [showHistory, setShowHistory] = useState(false);

  const data = useMemo(() => {
    const segments = splitKhatmahs(rows, tz, today);
    if (segments.length === 0) return null;
    const current = segments[segments.length - 1];
    const pos = khatmahPosition(current.pages);
    const pace = recentPace(rows, tz, today, 30);
    return {
      segments,
      current,
      finished: segments.slice(0, -1),
      pos,
      surah: surahForPage("uthmani15", pos.page).name,
      etaDays: pace > 0 && pos.left > 0 ? Math.ceil(pos.left / pace) : null,
      pace,
    };
  }, [rows, tz, today]);

  if (!data) {
    return (
      <div className="rounded-2xl bg-surface p-4 shadow-e1">
        <p className="text-callout font-semibold">Group khatmah</p>
        <p className="mt-2 text-footnote text-muted">
          Every page anyone in the circle logs counts toward one shared
          khatmah. The first entry starts it.
        </p>
      </div>
    );
  }

  const { current, finished, pos, surah, etaDays } = data;
  const juzPhrase =
    pos.pagesIntoJuz < 1
      ? `start of Juz ${pos.juz}`
      : `Juz ${pos.juz}, ${Math.floor(pos.pagesIntoJuz)} of ${pos.juzLength} pages in`;

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-callout font-semibold">Khatmah #{current.n}</p>
          <p className="text-caption text-faint">
            {current.days === 0
              ? "Started today"
              : `Since ${dateLabel(current.startDate, today)} · ${dayWord(current.days)}`}
          </p>
        </div>
        <button
          onClick={() => setShowHistory(true)}
          className="-mr-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 py-1 pl-2.5 pr-1.5 text-caption font-medium text-muted"
        >
          <History className="size-3.5" />
          History
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {/* Headline: juz done in THIS khatmah (never the all-time pile). */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-display">{pos.juzDone}</span>
        <span className="text-callout text-muted">of 30 juz done</span>
      </div>
      <p className="mt-0.5 text-footnote text-muted">
        {fmt1(pos.pages)} of {KHATMAH_PAGES} pages · now on p.{pos.page} ({juzPhrase},{" "}
        {surah})
      </p>

      <JuzStrip done={pos.juzDone} partial={pos.pagesIntoJuz / pos.juzLength} />
      <div className="mt-1 flex justify-between text-caption text-faint">
        <span>Juz 1</span>
        <span>Juz 30</span>
      </div>

      <p className="mt-2 text-footnote text-faint">
        {fmt1(pos.left)} pages to go
        {etaDays ? ` · about ${dayWord(etaDays)} at the circle’s recent pace` : ""}
      </p>

      {finished.length > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-accent-tint px-3 py-2.5 text-accent">
          <UtensilsCrossed className="size-4 shrink-0" />
          <p className="text-footnote font-medium">
            {finished.length} {finished.length === 1 ? "khatmah" : "khatmahs"}{" "}
            completed ·{" "}
            {finished.length === 1 ? "a dawat is" : `${finished.length} dawats are`}{" "}
            owed 🎉
          </p>
        </div>
      )}

      <Sheet
        open={showHistory}
        onClose={() => setShowHistory(false)}
        labelledBy="khatmah-history-title"
      >
        <KhatmahHistory
          segments={data.segments}
          today={today}
          onClose={() => setShowHistory(false)}
        />
      </Sheet>
    </div>
  );
}

/** 30 cells, one per juz: done, the one in progress (partly filled), to come. */
function JuzStrip({ done, partial }: { done: number; partial: number }) {
  return (
    <div
      role="img"
      aria-label={`${done} of 30 juz done`}
      className="mt-3 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[2px]"
    >
      {Array.from({ length: 30 }, (_, i) => {
        const state = i < done ? "done" : i === done && done < 30 ? "now" : "todo";
        return (
          <span
            key={i}
            className={cn(
              "relative h-3.5 overflow-hidden rounded-[3px]",
              state === "done" ? "bg-accent" : "bg-surface-2",
            )}
          >
            {state === "now" && partial > 0 && (
              <span
                className="absolute inset-y-0 left-0 bg-accent/60"
                style={{ width: `${Math.max(12, partial * 100)}%` }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

function KhatmahHistory({
  segments,
  today,
  onClose,
}: {
  segments: KhatmahSegment[];
  today: string;
  onClose: () => void;
}) {
  const finished = segments.filter((s) => s.endDate != null);
  const fastest =
    finished.length > 1 ? Math.min(...finished.map((s) => s.days)) : null;
  const maxDays = Math.max(1, ...segments.map((s) => s.days));
  const newestFirst = [...segments].reverse();

  return (
    <div className="px-5 pt-2 pb-2">
      <h2 id="khatmah-history-title" className="text-title2">
        Khatmah history
      </h2>
      <p className="mt-1 text-footnote text-muted">
        How long each khatmah took the circle, counting every page anyone
        logged.
      </p>

      <div className="mt-5 space-y-4">
        {newestFirst.map((s) => {
          const open = s.endDate == null;
          const perDay = s.days > 0 ? s.pages / s.days : s.pages;
          return (
            <div key={s.n}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-callout font-semibold">
                  Khatmah #{s.n}
                  {open && (
                    <span className="ml-2 rounded-full bg-accent-tint px-2 py-0.5 text-caption font-medium text-accent">
                      In progress
                    </span>
                  )}
                  {!open && s.days === fastest && (
                    <span className="ml-2 rounded-full bg-accent-tint px-2 py-0.5 text-caption font-medium text-accent">
                      Fastest
                    </span>
                  )}
                </p>
                <p className="shrink-0 text-subhead font-semibold">
                  {open ? `${dayWord(s.days)} so far` : dayWord(s.days)}
                </p>
              </div>
              <p className="text-footnote text-muted">
                {open
                  ? `Since ${dateLabel(s.startDate, today)} · ${fmt1(s.pages)} of ${KHATMAH_PAGES} pages`
                  : `${dateLabel(s.startDate, today)} to ${dateLabel(s.endDate!, today)} · ${fmt1(perDay)} pages a day`}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full",
                    open ? "bg-accent/50" : "bg-accent",
                  )}
                  style={{ width: `${Math.max(2, (s.days / maxDays) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-caption text-faint">
        Bars compare how many days each one took. Measured on the 604-page
        Uthmani mushaf.
      </p>

      <Button fullWidth className="mt-5" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
