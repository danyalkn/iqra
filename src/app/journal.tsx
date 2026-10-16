import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ArrowLeft, NotebookPen, StickyNote } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { EntryRow } from "@/components/EntryRow";
import { LogSheet } from "@/components/LogSheet";
import { Placeholder } from "@/components/Placeholder";
import { Chip, ChipText, SegmentedControl } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { deleteEntry, markEntriesChanged, updateEntry } from "@/data/entryWrites";
import { useMembership } from "@/hooks/use-membership";
import { useTheme } from "@/hooks/use-theme";
import { getMyEntriesAllTime } from "@/lib/data";
import { dayLabel, localDate, todayLocal, yesterdayLocal } from "@/lib/dates";
import { ENTRY_META, pagesEquiv, TYPES_BY_MODE, type EntryType } from "@/lib/entries";
import { pageFromRef } from "@/lib/mushaf";
import { absolutePage, rowJuzPage } from "@/lib/position";
import type { LogRow, NewEntry } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

type ViewMode = "day" | "juz";
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
  const page =
    e.entry_type === "reading" || e.entry_type === "revising" ? pageFromRef(e.to_ref) : null;
  return page ?? Number.POSITIVE_INFINITY;
}

/** Newest first, the order the server returns (used to re-slot a row after
 *  a failed delete). */
function newestFirst(a: LogRow, b: LogRow): number {
  return a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0;
}

/**
 * Everything you've ever logged, with your notes - Today only shows today.
 * Stack screen over the tabs, opened from Today (as on the web), so there is
 * no tab bar under it. Ported from reference/web-pwa/app/(app)/journal/
 * (page.tsx + JournalClient.tsx). The web page loaded the list on the server
 * and handed it to the client; here it arrives asynchronously after mount.
 */
export default function JournalScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile } = useSession();
  const { membership } = useMembership();

  const mode = profile?.mode ?? "reading";
  const tz = profile?.timezone ?? "UTC";
  const mushaf = profile?.mushaf ?? "uthmani15";
  const userId = user?.id ?? null;
  const groupId = membership?.group_id ?? null;

  const [entries, setEntries] = useState<LogRow[]>([]);
  // False until the first load lands, so the empty states never flash
  // "Nothing logged yet" over a list that is still on its way.
  const [loaded, setLoaded] = useState(false);
  const hasNotes = useMemo(() => entries.some((e) => e.notes), [entries]);
  // Notes are the reason most people open this page - lead with them when
  // there are any. The web initialised this from the server-rendered list;
  // native decides once, when the first load completes (never from the empty
  // initial array), and leaves the toggle alone after that.
  const [notesOnly, setNotesOnly] = useState(false);
  const notesDefaulted = useRef(false);
  const [view, setView] = useState<ViewMode>("day");
  const [type, setType] = useState<TypeFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  // The entry in the edit sheet stays set while the sheet animates closed,
  // so its content doesn't flip to a blank form on the way out.
  const [editing, setEditing] = useState<LogRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Write failures (save / delete) only; a failed load is its own state so
  // the "Nothing logged yet" empty state never shows over a list that
  // simply never arrived.
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Bumped by "Try again" to re-run the load effect.
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!groupId || !userId) return;
    let cancelled = false;
    getMyEntriesAllTime(supabase, groupId, userId)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        setLoadError(false);
        if (!notesDefaulted.current) {
          notesDefaulted.current = true;
          setNotesOnly(rows.some((e) => e.notes));
        }
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Leave notesDefaulted alone so the first successful load still
        // picks the notes default.
        setLoadError(true);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, userId, reloadTick]);

  const retryLoad = () => {
    setLoadError(false);
    setLoaded(false);
    setReloadTick((t) => t + 1);
  };

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
  const activeType: TypeFilter = type !== "all" && !typeChips.includes(type) ? "all" : type;

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (!notesOnly || !!e.notes) && (activeType === "all" || e.entry_type === activeType),
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
      list.sort((a, b) => placeKey(a) - placeKey(b) || newestFirst(a, b));
    }
    // Juz order, with anything unplaced at the end.
    return [...groups.entries()].sort((a, b) => (a[0] || 99) - (b[0] || 99));
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
    view === "day" ? filtered.length - shown.length : filtered.length - juzShown.rows;

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
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
      if (removed) setEntries((p) => [...p, removed].sort(newestFirst));
      setError(err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    markEntriesChanged();
  };

  const countLabel = notesOnly
    ? `${filtered.length} ${filtered.length === 1 ? "note" : "notes"}`
    : `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;

  const backButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/today"))}
      hitSlop={8}
      style={[styles.back, { backgroundColor: c.surface2 }]}
    >
      <ArrowLeft size={20} color={c.muted} />
    </Pressable>
  );

  // Not in a circle yet: the web page rendered the Placeholder in place of
  // the whole screen (page.tsx). Keep the back button so the screen can be
  // left, since a stack card has no other way out.
  if (membership === null) {
    return (
      <View style={[styles.root, { backgroundColor: c.canvas, paddingTop: insets.top }]}>
        <Placeholder
          icon={NotebookPen}
          title="Journal"
          note="You’re not in a circle yet. Once you’re added and start logging, every entry and note you write collects here."
          headerRight={backButton}
        />
      </View>
    );
  }

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

  // Section headings: footnote, medium, uppercase, tracking-wider, faint.
  const headingText = [Type.footnote, styles.headingText, { color: c.faint }];

  return (
    <View style={[styles.root, { backgroundColor: c.canvas }]}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: insets.bottom + 40 }}
      >
        <View style={styles.header}>
          {backButton}
          <Text style={[Type.title1, { color: c.foreground }]}>Journal</Text>
        </View>
        <Text style={[Type.footnote, styles.lede, { color: c.muted }]}>
          Everything you’ve logged, with your notes.
        </Text>

        {/* Membership still loading: header plus an empty body, like the web's
            server render before the data arrived. */}
        {membership !== undefined && loaded && (
          <>
            {/* Nothing to filter when the load failed, so the controls stay
                hidden until a retry succeeds. */}
            {!loadError && (
              <View style={styles.controls}>
                <SegmentedControl<ViewMode>
                  segments={[
                    { value: "day", label: "By day" },
                    { value: "juz", label: "By juz" },
                  ]}
                  value={view}
                  onChange={setView}
                />

                {/* Filters: notes first, then the entry types you actually use. */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.filtersBleed}
                  contentContainerStyle={styles.filters}
                >
                  <Chip
                    active={notesOnly}
                    onPress={() => {
                      setNotesOnly((v) => !v);
                      setLimit(PAGE);
                    }}
                  >
                    <StickyNote size={14} color={notesOnly ? c.accent : c.muted} />
                    <ChipText active={notesOnly}>With notes</ChipText>
                  </Chip>
                  {typeChips.length > 1 && (
                    <>
                      <View style={[styles.divider, { backgroundColor: c.border }]} />
                      <Chip active={activeType === "all"} onPress={() => setType("all")}>
                        All types
                      </Chip>
                      {typeChips.map((t) => (
                        <Chip
                          key={t}
                          active={activeType === t}
                          onPress={() => {
                            setType(t);
                            setLimit(PAGE);
                          }}
                        >
                          {ENTRY_META[t].label}
                        </Chip>
                      ))}
                    </>
                  )}
                </ScrollView>

                {error && (
                  <Text
                    style={[
                      Type.footnote,
                      styles.error,
                      { backgroundColor: c.dangerTint, color: c.danger },
                    ]}
                  >
                    {error}
                  </Text>
                )}

                {filtered.length > 0 && (
                  <Text style={[Type.footnote, styles.count, { color: c.faint }]}>
                    {countLabel}
                    {view === "juz" ? " · in mushaf order within each juz" : ""}
                  </Text>
                )}
              </View>
            )}

            <View style={styles.sections}>
              {loadError ? (
                <>
                  <EmptyState
                    icon={NotebookPen}
                    title="Couldn’t load your journal"
                    note="Check your connection and try again."
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={retryLoad}
                    style={({ pressed }) => [
                      styles.showMore,
                      { backgroundColor: c.surface2 },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[Type.subhead, styles.showMoreText, { color: c.muted }]}>
                      Try again
                    </Text>
                  </Pressable>
                </>
              ) : entries.length === 0 ? (
                <EmptyState
                  icon={NotebookPen}
                  title="Nothing logged yet"
                  note="Your entries and the notes you add to them collect here, day after day."
                />
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={NotebookPen}
                  title={notesOnly && !hasNotes ? "No notes yet" : "Nothing matches"}
                  note={
                    notesOnly && !hasNotes
                      ? "When you log, tap “Add a note” to write down what you covered or how it went. It will show up here."
                      : "Try another filter."
                  }
                />
              ) : view === "day" ? (
                byDay.map(([ymd, rows]) => (
                  <View key={ymd}>
                    <Text style={[headingText, styles.heading]}>{dayHeading(ymd)}</Text>
                    <View style={styles.rows}>{rows.map((e) => row(e, false))}</View>
                  </View>
                ))
              ) : (
                juzShown.groups.map(([juz, rows]) => (
                  <View key={juz}>
                    <View style={styles.juzHead}>
                      <Text style={headingText}>
                        {juz === 0 ? "No juz recorded" : `Juz ${juz}`}
                      </Text>
                      <Text style={[Type.caption, { color: c.faint }]}>
                        {rows.length} {rows.length === 1 ? "entry" : "entries"}
                      </Text>
                    </View>
                    <View style={styles.rows}>{rows.map((e) => row(e, true))}</View>
                  </View>
                ))
              )}

              {hiddenCount > 0 && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setLimit((l) => l + PAGE)}
                  style={({ pressed }) => [
                    styles.showMore,
                    { backgroundColor: c.surface2 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[Type.subhead, styles.showMoreText, { color: c.muted }]}>
                    {view === "day"
                      ? `Show more (${hiddenCount} older)`
                      : `Show more juz (${hiddenCount} more ${hiddenCount === 1 ? "entry" : "entries"})`}
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <LogSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        initialType={editing?.entry_type ?? "reading"}
        onSave={handleSave}
        editing={editing}
        mushaf={mushaf}
        tz={tz}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  lede: { paddingHorizontal: 20 },
  controls: { gap: 12, paddingHorizontal: 20, paddingTop: 16 },
  // -mx-5 / px-5: the chip row bleeds to the screen edges and scrolls under
  // the gutter.
  filtersBleed: { marginHorizontal: -20 },
  filters: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20 },
  divider: { width: 1, alignSelf: "stretch", marginVertical: 4 },
  error: {
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  count: { paddingHorizontal: 4 },
  sections: { gap: 20, marginTop: 8, paddingHorizontal: 20 },
  headingText: { fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.65 },
  heading: { marginBottom: 8, paddingHorizontal: 4 },
  juzHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  rows: { gap: 10 },
  showMore: {
    width: "100%",
    borderRadius: Radius.md,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  showMoreText: { fontWeight: "500" },
  pressed: { opacity: 0.8 },
});
