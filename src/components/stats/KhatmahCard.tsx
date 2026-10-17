/**
 * The circle's khatmah: which one we're on, how many juz of it are done,
 * the page we've reached, and (in a sheet) how long each past one took.
 * Every member's page-bearing entry counts, measured on the Uthmani mushaf.
 * Ported 1:1 from reference/web-pwa/app/(app)/stats/KhatmahCard.tsx; no
 * chart here, the juz strip and the history bars are plain Views.
 *
 * Native differences: the history sheet wraps its content in a ScrollView
 * (the list grows with every finished khatmah), so the Sheet gets
 * dragAnywhere={false} and only its handle dismisses by drag.
 */
import { ChevronRight, History, UtensilsCrossed } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, Card, Sheet } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { shortDate } from "@/lib/dates";
import {
  KHATMAH_PAGES,
  khatmahPosition,
  recentPace,
  splitKhatmahs,
  type KhatmahSegment,
} from "@/lib/khatmah";
import { surahForPage } from "@/lib/mushaf";

import type { KhatmahCardProps } from "./types";

const fmt1 = (n: number) => String(+n.toFixed(1));

/** "7 Jun", or "7 Jun 2025" outside the current year. */
function dateLabel(ymd: string, today: string): string {
  const base = shortDate(ymd);
  return ymd.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${ymd.slice(0, 4)}`;
}

const dayWord = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export function KhatmahCard({ rows, tz, today }: KhatmahCardProps) {
  const c = useTheme();
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
      <Card>
        <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>Group khatmah</Text>
        <Text style={[Type.footnote, styles.mt2, { color: c.muted }]}>
          Every page anyone in the circle logs counts toward one shared khatmah. The first
          entry starts it.
        </Text>
      </Card>
    );
  }

  const { current, finished, pos, surah, etaDays } = data;
  const juzPhrase =
    pos.pagesIntoJuz < 1
      ? `start of Juz ${pos.juz}`
      : `Juz ${pos.juz}, ${Math.floor(pos.pagesIntoJuz)} of ${pos.juzLength} pages in`;
  const close = () => setShowHistory(false);

  return (
    <Card>
      <View style={styles.top}>
        <View style={styles.topText}>
          <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
            Khatmah #{current.n}
          </Text>
          <Text style={[Type.caption, { color: c.faint }]}>
            {current.days === 0
              ? "Started today"
              : `Since ${dateLabel(current.startDate, today)} · ${dayWord(current.days)}`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Khatmah history"
          onPress={() => setShowHistory(true)}
          hitSlop={6}
          style={({ pressed }) => [
            styles.historyPill,
            { backgroundColor: c.surface2, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <History size={14} color={c.muted} />
          <Text style={[Type.caption, { color: c.muted }]}>History</Text>
          <ChevronRight size={14} color={c.muted} />
        </Pressable>
      </View>

      {/* Headline: juz done in THIS khatmah (never the all-time pile). */}
      <View style={styles.headline}>
        <Text style={[Type.display, { color: c.foreground }]}>{pos.juzDone}</Text>
        <Text style={[Type.callout, { color: c.muted }]}>of 30 juz done</Text>
      </View>
      <Text style={[Type.footnote, styles.mt05, { color: c.muted }]}>
        {fmt1(pos.pages)} of {KHATMAH_PAGES} pages · now on p.{pos.page} ({juzPhrase}, {surah})
      </Text>

      <JuzStrip done={pos.juzDone} partial={pos.pagesIntoJuz / pos.juzLength} />
      <View style={styles.stripLabels}>
        <Text style={[Type.caption, { color: c.faint }]}>Juz 1</Text>
        <Text style={[Type.caption, { color: c.faint }]}>Juz 30</Text>
      </View>

      <Text style={[Type.footnote, styles.mt2, { color: c.faint }]}>
        {fmt1(pos.left)} pages to go
        {etaDays ? ` · about ${dayWord(etaDays)} at the circle’s recent pace` : ""}
      </Text>

      {finished.length > 0 && (
        <View style={[styles.dawat, { backgroundColor: c.accentTint }]}>
          <UtensilsCrossed size={16} color={c.accent} />
          <Text style={[Type.footnote, styles.medium, styles.dawatText, { color: c.accent }]}>
            {finished.length} {finished.length === 1 ? "khatmah" : "khatmahs"} completed ·{" "}
            {finished.length === 1 ? "a dawat is" : `${finished.length} dawats are`} owed 🎉
          </Text>
        </View>
      )}

      <Sheet open={showHistory} onClose={close} dragAnywhere={false}>
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.sheetContent}
        >
          <KhatmahHistory segments={data.segments} today={today} onClose={close} />
        </ScrollView>
      </Sheet>
    </Card>
  );
}

/** 30 cells, one per juz: done, the one in progress (partly filled), to come. */
function JuzStrip({ done, partial }: { done: number; partial: number }) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${done} of 30 juz done`}
      style={styles.strip}
    >
      {Array.from({ length: 30 }, (_, i) => {
        const state = i < done ? "done" : i === done && done < 30 ? "now" : "todo";
        return (
          <View
            key={i}
            style={[
              styles.stripCell,
              { backgroundColor: state === "done" ? c.accent : c.surface2 },
            ]}
          >
            {state === "now" && partial > 0 && (
              <View
                style={[
                  styles.stripPartial,
                  { backgroundColor: c.accent, width: `${Math.max(12, partial * 100)}%` },
                ]}
              />
            )}
          </View>
        );
      })}
    </View>
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
  const c = useTheme();
  const finished = segments.filter((s) => s.endDate != null);
  const fastest = finished.length > 1 ? Math.min(...finished.map((s) => s.days)) : null;
  const newestFirst = [...segments].reverse();

  return (
    <View>
      <Text style={[Type.title2, { color: c.foreground }]}>Khatmah history</Text>
      <Text style={[Type.footnote, styles.mt1, { color: c.muted }]}>
        How long each khatmah took the circle, counting every page anyone logged.
      </Text>

      <View style={styles.historyList}>
        {newestFirst.map((s) => {
          const open = s.endDate == null;
          const perDay = s.days > 0 ? s.pages / s.days : s.pages;
          const pill = open ? "In progress" : s.days === fastest ? "Fastest" : null;
          return (
            <View key={s.n}>
              <View style={styles.historyTitleRow}>
                <View style={styles.historyTitle}>
                  <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
                    Khatmah #{s.n}
                  </Text>
                  {pill && (
                    <View style={[styles.pill, { backgroundColor: c.accentTint }]}>
                      <Text style={[Type.caption, { color: c.accent }]}>{pill}</Text>
                    </View>
                  )}
                </View>
                <Text style={[Type.subhead, styles.semibold, styles.days, { color: c.foreground }]}>
                  {open ? `${dayWord(s.days)} so far` : dayWord(s.days)}
                </Text>
              </View>
              <Text style={[Type.footnote, { color: c.muted }]}>
                {open
                  ? `Since ${dateLabel(s.startDate, today)} · ${fmt1(s.pages)} of ${KHATMAH_PAGES} pages`
                  : `${dateLabel(s.startDate, today)} to ${dateLabel(s.endDate ?? s.startDate, today)} · ${fmt1(perDay)} pages a day`}
              </Text>
              {/* The bar is completion, not duration: a finished khatmah is
                  full and the open one fills to its share of the 604 pages.
                  Sized by days, the fastest khatmah drew the shortest bar
                  and read as unfinished (owner, 2026-10-17); speed is in the
                  day count, the pace line and the Fastest pill instead. */}
              <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      backgroundColor: c.accent,
                      width: open
                        ? `${Math.max(2, Math.min(100, (s.pages / KHATMAH_PAGES) * 100))}%`
                        : "100%",
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      <Text style={[Type.caption, styles.mt5, { color: c.faint }]}>
        Bars show how much of each khatmah is done. Measured on the 604-page Uthmani mushaf.
      </Text>

      <Button fullWidth style={styles.mt5} onPress={onClose}>
        Done
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  mt05: { marginTop: 2 },
  mt1: { marginTop: 4 },
  mt2: { marginTop: 8 },
  mt5: { marginTop: 20 },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  topText: { flexShrink: 1 },
  // Web: -mr-1 rounded-full bg-surface-2 py-1 pl-2.5 pr-1.5
  historyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    borderRadius: 999,
    paddingVertical: 4,
    paddingLeft: 10,
    paddingRight: 6,
    marginRight: -4,
  },
  headline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 8,
    rowGap: 2,
    marginTop: 12,
  },
  strip: { flexDirection: "row", gap: 2, marginTop: 12 },
  stripCell: { flex: 1, height: 14, borderRadius: 3, overflow: "hidden" },
  stripPartial: { position: "absolute", top: 0, bottom: 0, left: 0, opacity: 0.6 },
  stripLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  dawat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dawatText: { flex: 1 },
  // Web: px-5 pt-2 pb-2 inside the sheet.
  sheetContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  historyList: { marginTop: 20, gap: 16 },
  historyTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  historyTitle: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  days: { flexShrink: 0 },
  bar: { height: 6, borderRadius: 999, overflow: "hidden", marginTop: 6 },
  barFill: { height: "100%", borderRadius: 999 },
});
