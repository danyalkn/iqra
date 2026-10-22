import * as Haptics from "expo-haptics";
import { Plus, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Button,
  Card,
  FieldLabel,
  Input,
  SegmentedControl,
  Sheet,
  SheetScroll,
  Switch,
  Textarea,
} from "@/components/ui";
import { WheelPicker } from "@/components/WheelPicker";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { BACKDATE_CUTOFF, localHm, yesterdayLocal, zonedIso } from "@/lib/dates";
import { ENTRY_META, isReadingType, type EntryType } from "@/lib/entries";
import {
  defaultPortion,
  freshHifzDefaults,
  hifzEntry,
  PORTIONS,
  portionFromUnit,
  readingEntry,
  REV_PAGES,
  SABAK_PAGES,
  type Portion,
} from "@/lib/entryDefaults";
import {
  clampPage,
  DEFAULT_MUSHAF,
  locatePage,
  pageFromRef,
  totalPages,
  type MushafId,
} from "@/lib/mushaf";
import {
  absolutePage,
  juzLength,
  juzPageFromLabel,
  juzPageLabel,
  juzPageOptions,
  needsQuarters,
  pagesPhrase,
  positionLabel,
  positionSaysAmount,
  rowJuzPage,
} from "@/lib/position";
import type { LogRow, NewEntry } from "@/lib/types";

const JUZ = Array.from({ length: 30 }, (_, i) => i + 1);

// The "Starts at" wheel: "–" = not specified, then half-page steps (quarter
// steps whenever the amount or the start needs them).
const NO_START = "–";
function startFromLabel(label: string): number | null {
  return label === NO_START ? null : juzPageFromLabel(label);
}

/** Arabic-Indic (U+0660..) and Eastern Arabic-Indic (U+06F0..) digits as
 *  ASCII, and the Arabic decimal separator as a comma. */
function asciiNumber(v: string): string {
  return v
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, ",");
}

/** "Juz 3 · p.3, 2nd half" (+ the amount when the label doesn't say it). */
function portionSummary(juz: number, start: number | null, pages: number): string {
  if (start == null) return `Juz ${juz} · ${pagesPhrase(pages)}`;
  const where = positionLabel(start, pages);
  return positionSaysAmount(start, pages)
    ? `Juz ${juz} · ${where}`
    : `Juz ${juz} · ${where} · ${pagesPhrase(pages)}`;
}

type Props = {
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
  /** Pages to prefill for a fresh entry (a notification action's amount
   *  arriving through /today?log=<type>&amount=<n>). Ignored when editing. */
  presetAmount?: number | null;
  /** Juz to prefill for a fresh hifz revision (a row on Today's revision
   *  card). Overrides only the juz of the carry-on defaults. Ignored when
   *  editing. */
  presetJuz?: number | null;
};

/**
 * The log form in a bottom sheet (reference/web-pwa/components/LogSheet.tsx).
 *
 * The web reset every field in an effect each time the sheet opened. Native
 * remounts the form instead (keyed on an open counter plus the same inputs
 * the web's reset effect depended on), so every field initialises from props
 * once, with no setState in an effect body.
 */
export function LogSheet(props: Props) {
  const { open, onClose, initialType, editing, mushaf = DEFAULT_MUSHAF, tz } = props;

  // A reading being edited keeps its own mushaf (its bookmark page is in
  // it). Hifz positions are juz-relative, so they always use the user's
  // mushaf; older hifz rows only carry the column's default.
  const mush: MushafId =
    editing && isReadingType(editing.entry_type)
      ? (editing.mushaf ?? mushaf)
      : mushaf;

  // Count opens (adjusted during render, the React-sanctioned way to react to
  // a prop flip) so each open mounts a fresh form.
  const [prevOpen, setPrevOpen] = useState(open);
  const [generation, setGeneration] = useState(0);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setGeneration((g) => g + 1);
  }
  // The row's id rather than its identity: a save confirming in the background
  // can swap the edited row for the server's copy without wiping the form.
  const liveKey = `${generation}:${initialType}:${editing?.id ?? ""}:${mush}:${tz}:${props.presetAmount ?? ""}:${props.presetJuz ?? ""}`;

  // Live while open (the web's reset effect re-ran on these while open), but
  // frozen once `open` turns false: Today nulls `editing` in the same call
  // that closes the sheet, and a new key here would remount a blank "Log"
  // form inside the panel while it is still sliding down. `editing` and
  // `mush` are latched with it so the header, Save label and backdate control
  // hold still too (the web let those flip during its exit).
  const [snap, setSnap] = useState({ key: liveKey, editing, mush });
  if (open && (liveKey !== snap.key || editing !== snap.editing || mush !== snap.mush)) {
    setSnap({ key: liveKey, editing, mush });
  }
  const shown = open ? { key: liveKey, editing, mush } : snap;

  return (
    <Sheet open={open} onClose={onClose} dragAnywhere={false}>
      <LogForm key={shown.key} {...props} editing={shown.editing} mush={shown.mush} />
    </Sheet>
  );
}

/** Everything the web's open-effect set, computed once at mount. */
function initialForm({
  editing,
  initialType,
  mush,
  last,
  preset,
  presetJuz,
}: {
  editing: LogRow | null | undefined;
  initialType: EntryType;
  mush: MushafId;
  last: LogRow | null | undefined;
  preset: number | null | undefined;
  presetJuz: number | null | undefined;
}) {
  const base = {
    notes: editing?.notes ?? "",
    showNotes: Boolean(editing?.notes),
    // Auto-advance on by default for a fresh reading; off when editing so the
    // stored page shows as-is.
    autoPage: !editing,
    pagesRead: "",
    stoppedAt: "",
    juz: 1,
    portion: defaultPortion(initialType),
    part: 1,
    pages: 1,
    start: null as number | null,
  };

  if (editing) {
    // Prefill from the entry being edited.
    if (isReadingType(editing.entry_type)) {
      const p = pageFromRef(editing.to_ref);
      return {
        ...base,
        pagesRead: editing.amount != null ? String(editing.amount) : "",
        stoppedAt: p != null ? String(p) : "",
      };
    }
    if (editing.entry_type === "sabak") {
      return {
        ...base,
        juz: editing.juz ?? 1,
        pages: editing.amount ?? 1,
        start: rowJuzPage(editing),
      };
    }
    return {
      ...base,
      juz: editing.juz ?? 1,
      portion: portionFromUnit(editing.unit),
      part: editing.part ?? 1,
      pages: editing.amount ?? 1,
      start: rowJuzPage(editing),
    };
  }

  // Fresh entry defaults: carry on from the last entry of this type, so
  // tomorrow's sabak is usually one tap. Shared with the notification
  // actions (src/lib/entryDefaults), which save these defaults untouched.
  if (!isReadingType(initialType)) {
    const d = freshHifzDefaults(initialType, last, mush);
    // A preset amount only lands where the wheels can show it.
    if (preset != null) {
      if (initialType === "sabak" && SABAK_PAGES.includes(preset)) d.pages = preset;
      else if (initialType !== "sabak" && REV_PAGES.includes(preset)) {
        d.portion = "Pages";
        d.pages = preset;
      }
    }
    // A preset juz replaces the carried-on one. The start page and the
    // rotating half / quarter belong to the last entry's juz, so they only
    // carry over when that entry was in this juz too (Today passes the
    // newest entry of the type in the preset juz when it has one).
    if (presetJuz != null && presetJuz >= 1 && presetJuz <= 30 && presetJuz !== d.juz) {
      d.juz = presetJuz;
      d.start = null;
      d.part = 1;
    }
    return { ...base, ...d };
  }
  return { ...base, pagesRead: preset != null ? String(preset) : "" };
}

function LogForm({
  open,
  onClose,
  initialType,
  onSave,
  editing,
  lastReadPage,
  lastOfType,
  mush,
  tz,
  presetAmount,
  presetJuz,
}: Props & { mush: MushafId }) {
  const c = useTheme();
  const maxPage = totalPages(mush);
  const reading = isReadingType(initialType);
  const sabak = initialType === "sabak";
  const meta = ENTRY_META[initialType];
  const verb = sabak ? "memorizing" : "revising";

  // The defaults read the newest entry of this type, but only when the sheet
  // opens (this mounts): a save confirming in the background swaps that row
  // for the server's copy, and re-deriving then would wipe what's being
  // typed. The web kept a ref for the same reason.
  const [init] = useState(() =>
    initialForm({ editing, initialType, mush, last: lastOfType, preset: presetAmount, presetJuz }),
  );

  // hifz
  const [juz, setJuz] = useState(init.juz);
  const [portion, setPortion] = useState<Portion>(init.portion);
  const [part, setPart] = useState(init.part);
  const [pages, setPages] = useState(init.pages); // sabak + revision "Pages"
  // Where in the juz the portion starts (juz-relative page, half steps).
  const [start, setStart] = useState<number | null>(init.start);
  // reading
  const [pagesRead, setPagesRead] = useState(init.pagesRead);
  const [stoppedAt, setStoppedAt] = useState(init.stoppedAt);
  // When on, the last page = previous bookmark + pages read (auto-advance).
  const [autoPage, setAutoPage] = useState(init.autoPage);
  // shared
  const [notes, setNotes] = useState(init.notes);
  const [showNotes, setShowNotes] = useState(init.showNotes);
  const [when, setWhen] = useState<"today" | "yesterday">("today");
  // Only between midnight and 3 AM can an entry go to yesterday; decided
  // when the sheet opens, in the profile's timezone.
  const [canBackdate, setCanBackdate] = useState(
    () => localHm(Date.now(), tz) < BACKDATE_CUTOFF,
  );
  const [error, setError] = useState<string | null>(null);

  // An open sheet can outlive the moment either way (an iPhone puts the app
  // away with the sheet up): re-check when the app comes back to the front.
  // If yesterday was picked and has since closed, say so instead of quietly
  // saving to the wrong day.
  const whenRef = useRef(when);
  useEffect(() => {
    whenRef.current = when;
  }, [when]);
  useEffect(() => {
    if (!open) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const ok = localHm(Date.now(), tz) < BACKDATE_CUTOFF;
      setCanBackdate(ok);
      if (!ok && whenRef.current === "yesterday") {
        setWhen("today");
        setError("It’s past 3 AM, so yesterday is closed. This will save for today.");
      }
    });
    return () => sub.remove();
  }, [open, tz]);

  // Web: autoFocus on the pages field. A TextInput mounting inside a Modal
  // that is still presenting can lose the focus request on iOS, so ask for it
  // once the Sheet's slide-in (300ms) has finished.
  const pagesRef = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (!reading) return;
    const t = setTimeout(() => pagesRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [reading]);

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
  // A bookmark is the last page read to its end, so name the page today's
  // reading begins on too. After a khatm the pages clamp at the last page
  // (readingEntry), so there is no next page to name.
  const autoNote = !autoPage
    ? "Enter the last page you finished."
    : lastReadPage == null
      ? "Counts from the start of the Qur’an."
      : lastReadPage < maxPage
        ? `You finished p.${lastReadPage} last time, so this starts at p.${lastReadPage + 1}.`
        : `Adds your pages onto p.${lastReadPage}.`;

  // Numbers only - up to 2 decimal places for pages, integer for the page no.
  // Keypads in comma-decimal regions (Android's decimal pad always) type
  // "1,5", and Arabic-script keypads type ١٢ or ۱۲: read them as 1.5 and 12.
  const onPagesReadChange = (v: string) => {
    const n = asciiNumber(v).replace(",", ".");
    if (/^\d*\.?\d{0,2}$/.test(n)) setPagesRead(n);
  };
  const onStoppedChange = (v: string) => {
    const n = asciiNumber(v);
    if (/^\d*$/.test(n)) setStoppedAt(n);
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

  const fail = (msg: string) => {
    setError(msg);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const save = () => {
    // Last line of defence for a sheet opened before 3 AM and saved after:
    // keep it open (nothing typed is lost) rather than send an entry the
    // database will refuse.
    if (backdating && localHm(Date.now(), tz) >= BACKDATE_CUTOFF) {
      setCanBackdate(false);
      setWhen("today");
      fail("It’s past 3 AM, so yesterday is closed. Save it for today instead?");
      return;
    }
    // Backdate to 11:59 PM yesterday *in the profile's timezone* - every
    // consumer (streaks, daily bars, feed grouping) buckets by that zone, not
    // the device's. Late, because a backdate now only happens between
    // midnight and 3 AM for last night's session: it must sort after anything
    // already logged yesterday, or an earlier bookmark would win.
    const loggedAt = backdating ? zonedIso(yesterdayLocal(tz), 23, tz, 59) : null;
    let entry: NewEntry;
    if (reading) {
      const amt = Number(pagesRead);
      if (!pagesRead.trim() || Number.isNaN(amt) || amt <= 0) {
        fail("Enter how many pages you read.");
        return;
      }
      // Manual last page is optional, but if entered it must be a real page.
      if (!autoAdvance && stoppedAt.trim() && !readLoc) {
        fail(`Last page must be 1–${maxPage}, or leave it blank.`);
        return;
      }
      // Auto-advance is the shared constructor's default; a typed (or
      // cleared) last page and a backdated reading keep the location that
      // was resolved above instead.
      const loc = finalLoc;
      entry = autoAdvance
        ? readingEntry(initialType, amt, lastReadPage ?? null, mush)
        : {
            ...readingEntry(initialType, amt, null, mush),
            to_ref: loc ? String(loc.page) : null, // page; juz/surah derived
            juz: loc ? loc.juz : null,
          };
    } else {
      // Sabak and revision rows from the wheel values (src/lib/entryDefaults).
      entry = hifzEntry(initialType, { juz, portion, part, pages, start }, mush);
    }
    entry = { ...entry, notes: notes.trim() || null, logged_at: loggedAt };
    // DECISIONS: haptics on log.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave(entry);
    onClose();
  };

  const caption = [Type.caption, styles.caption, { color: c.faint }];

  return (
    <>
      {/* Three 200px wheels plus fields outgrow a small phone, and the
          keyboard takes half of any phone: the Sheet caps its panel at 92%,
          keeps it above the keyboard and lets this shrink and scroll (to the
          focused field) instead of being clipped. The grab handle still
          dismisses. */}
      <SheetScroll bounces={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[Type.title2, { color: c.foreground }]}>
            {editing ? "Edit" : "Log"} {meta.label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: c.surface2 }]}
          >
            <X size={16} color={c.muted} />
          </Pressable>
        </View>
        <Text style={[Type.footnote, styles.desc, { color: c.muted }]}>{meta.desc}</Text>

        {reading ? (
          <View style={styles.readingWrap}>
            <View style={styles.centered}>
              <FieldLabel style={styles.labelTight}>Pages read</FieldLabel>
              <View style={styles.inline}>
                <Input
                  ref={pagesRef}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  value={pagesRead}
                  onChangeText={onPagesReadChange}
                  accessibilityLabel="Pages read"
                  style={[Type.title2, styles.pagesInput]}
                />
                <Text style={[Type.callout, { color: c.muted }]}>pages</Text>
              </View>
            </View>
            <View style={styles.fullWidth}>
              {/* Auto-advance the bookmark: last page = previous + pages read.
                  Hidden while backdating - see `autoAdvance`. */}
              {!backdating && (
                <Card style={styles.toggleRow}>
                  <View style={styles.grow}>
                    <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
                      Continue from last page
                    </Text>
                    <Text style={[Type.footnote, { color: c.muted }]}>{autoNote}</Text>
                  </View>
                  <Switch
                    value={autoPage}
                    onValueChange={setAutoPage}
                    accessibilityLabel="Continue from last page"
                  />
                </Card>
              )}

              {autoAdvance ? (
                <View style={styles.locRow}>
                  {finalLoc ? (
                    <>
                      <LocationPill
                        text={`Finished p.${finalLoc.page} · Juz ${finalLoc.juz} · ${finalLoc.surah.name}`}
                        arabic={finalLoc.surah.arabic}
                      />
                      <NextStartHint page={finalLoc.page} maxPage={maxPage} />
                    </>
                  ) : (
                    <Text style={[Type.footnote, { color: c.faint }]}>
                      Enter pages read to set your bookmark
                    </Text>
                  )}
                </View>
              ) : (
                <View style={styles.manual}>
                  <FieldLabel style={styles.labelTight}>
                    {backdating
                      ? "Last page you finished yesterday (optional)"
                      : "Last page you finished (optional)"}
                  </FieldLabel>
                  <Input
                    keyboardType="number-pad"
                    placeholder={`1–${maxPage}`}
                    value={stoppedAt}
                    onChangeText={onStoppedChange}
                    accessibilityLabel="Last page you finished"
                    style={styles.lastPageInput}
                  />
                  <View style={styles.locRowTight}>
                    {readLoc ? (
                      <>
                        <LocationPill
                          text={`Juz ${readLoc.juz} · ${readLoc.surah.name}`}
                          arabic={readLoc.surah.arabic}
                        />
                        <NextStartHint page={readLoc.page} maxPage={maxPage} />
                      </>
                    ) : stoppedAt ? (
                      <Text style={[Type.footnote, { color: c.faint }]}>
                        Enter a page from 1 to {maxPage}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )}
            </View>
          </View>
        ) : sabak ? (
          <>
            <FieldLabel>What did you memorize?</FieldLabel>
            <Card style={styles.wheelCard}>
              <View style={styles.captions}>
                <Text style={caption}>Juz</Text>
                <Text style={caption}>Starts at</Text>
                <Text style={caption}>Pages</Text>
              </View>
              <View style={styles.wheels}>
                <View style={styles.col}>
                  <WheelPicker options={JUZ} value={juz} onChange={onJuzChange} ariaLabel="Juz" />
                </View>
                <View style={styles.col}>
                  <WheelPicker
                    options={startOptions}
                    value={startValue}
                    onChange={(l) => setStart(startFromLabel(l))}
                    ariaLabel="Starts at page of the juz"
                  />
                </View>
                <View style={styles.col}>
                  <WheelPicker
                    options={SABAK_PAGES}
                    value={pages}
                    onChange={setPages}
                    ariaLabel="Pages"
                  />
                </View>
              </View>
            </Card>
            <Text style={[Type.footnote, styles.summary, { color: c.accent }]}>{summary}</Text>
            {showStartHint && <StartHint />}
          </>
        ) : (
          <>
            <FieldLabel>What are you {verb}?</FieldLabel>
            <Card style={styles.wheelCard}>
              <View style={styles.captions}>
                <Text style={caption}>Juz</Text>
                <Text style={caption}>Portion</Text>
                {portion === "Pages" && <Text style={caption}>Starts at</Text>}
                <Text style={caption}>{portion === "Pages" ? "Pages" : "Part"}</Text>
              </View>
              <View style={styles.wheels}>
                <View style={styles.col}>
                  <WheelPicker options={JUZ} value={juz} onChange={onJuzChange} ariaLabel="Juz" />
                </View>
                <View style={styles.col}>
                  <WheelPicker
                    options={PORTIONS}
                    value={portion}
                    onChange={(p) => {
                      setPortion(p);
                      setPart(1);
                    }}
                    ariaLabel="Portion"
                  />
                </View>
                {portion === "Pages" && (
                  <View style={styles.col}>
                    <WheelPicker
                      options={startOptions}
                      value={startValue}
                      onChange={(l) => setStart(startFromLabel(l))}
                      ariaLabel="Starts at page of the juz"
                    />
                  </View>
                )}
                <View style={styles.col}>
                  {portion === "Full" ? (
                    <View style={styles.fullPlaceholder}>
                      <Text style={[Type.callout, { color: c.faint }]}>–</Text>
                    </View>
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
                </View>
              </View>
            </Card>
            <Text style={[Type.footnote, styles.summary, { color: c.accent }]}>{summary}</Text>
            {showStartHint && <StartHint />}
          </>
        )}

        {/* When - backdate a forgotten entry to yesterday (new entries only,
            and only before 3 AM, so a missed day can't be patched later) */}
        {!editing && canBackdate && (
          <View style={styles.section}>
            <SegmentedControl
              segments={[
                { value: "today", label: "Today" },
                { value: "yesterday", label: "Yesterday" },
              ]}
              value={when}
              onChange={setWhen}
            />
            {when === "yesterday" && (
              <Text style={[Type.footnote, styles.hint, { color: c.faint }]}>
                Read last night and forgot to log? This saves it for yesterday.
                Open until 3 AM.
              </Text>
            )}
          </View>
        )}

        {/* Notes - collapsed by default */}
        <View style={styles.section}>
          {showNotes ? (
            <>
              <FieldLabel>Notes</FieldLabel>
              <Textarea
                placeholder="After Fajr, felt smooth…"
                value={notes}
                onChangeText={setNotes}
                // Focus when revealed by the "Add a note" tap; an entry opened
                // with notes already shows them without raising the keyboard.
                autoFocus={!init.showNotes}
              />
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setShowNotes(true)}
              style={styles.addNote}
            >
              <Plus size={16} color={c.accent} strokeWidth={2.5} />
              <Text style={[Type.subhead, { color: c.accent }]}>Add a note</Text>
            </Pressable>
          )}
        </View>
      </SheetScroll>

      {/* Pinned under the scroll so Save (and why it failed) stays on screen
          when the keyboard leaves the form too little room. */}
      <View style={styles.footer}>
        {error && <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>}
        <Button fullWidth style={styles.save} onPress={save}>
          {editing ? "Save changes" : "Save entry"}
        </Button>
      </View>
    </>
  );
}

/** "Juz 3 · Al-Baqarah" pill with the surah's Arabic name alongside. */
function LocationPill({ text, arabic }: { text: string; arabic: string }) {
  const c = useTheme();
  return (
    <View style={[styles.pill, { backgroundColor: c.accentTint }]}>
      <Text style={[Type.footnote, styles.medium, { color: c.accent }]}>{text}</Text>
      <Text style={[Type.footnote, styles.rtl, { color: c.faint }]}>{arabic}</Text>
    </View>
  );
}

/** Spells out what a bookmark page means: read to its end, so the next
 *  session starts on the page after (p.1 again after a khatm). "Now on p.80"
 *  alone read as "start on p.80". */
function NextStartHint({ page, maxPage }: { page: number; maxPage: number }) {
  const c = useTheme();
  return (
    <Text style={[Type.footnote, styles.nextStart, { color: c.muted }]}>
      {page >= maxPage
        ? `Read to the end of p.${page}, the last page. Next time, start again from p.1.`
        : `Read to the end of p.${page}, so next time start from p.${page + 1}.`}
    </Text>
  );
}

/** Nudge toward giving a position, without making it mandatory. */
function StartHint() {
  const c = useTheme();
  return (
    <Text style={[Type.footnote, styles.startHint, { color: c.faint }]}>
      Set “Starts at” to keep your place in the juz. 3½ means the second half of
      page 3.
    </Text>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8 },
  footer: { paddingHorizontal: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  desc: { marginBottom: 20 },
  // reading
  readingWrap: { alignItems: "center", gap: 24, paddingVertical: 4 },
  centered: { alignItems: "center", gap: 8 },
  labelTight: { marginBottom: 0 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  pagesInput: { width: 112, textAlign: "center" },
  lastPageInput: { width: 176, textAlign: "center" },
  fullWidth: { alignSelf: "stretch" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  // Room for the pill and its next-page line, held while empty so the sheet
  // doesn't jump as the first digit is typed. A wrapped line still grows it.
  locRow: { marginTop: 12, minHeight: 56, alignItems: "center", justifyContent: "center", gap: 6 },
  locRowTight: { minHeight: 56, alignItems: "center", justifyContent: "center", gap: 6 },
  nextStart: { textAlign: "center", paddingHorizontal: 4 },
  manual: { marginTop: 12, alignItems: "center", gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  rtl: { writingDirection: "rtl" },
  // hifz
  wheelCard: { padding: 6 },
  captions: { flexDirection: "row", marginBottom: 2 },
  caption: {
    flex: 1,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.65,
  },
  wheels: { flexDirection: "row" },
  col: { flex: 1 },
  fullPlaceholder: { height: 200, alignItems: "center", justifyContent: "center" },
  summary: { marginTop: 8, paddingHorizontal: 4 },
  startHint: { marginTop: 4, paddingHorizontal: 4 },
  // shared
  section: { marginTop: 20 },
  hint: { marginTop: 6, paddingHorizontal: 4 },
  addNote: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  error: { marginTop: 12 },
  save: { marginTop: 24 },
});
