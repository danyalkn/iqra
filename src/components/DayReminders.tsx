import { router } from "expo-router";
import {
  AlarmClock,
  AlarmClockCheck,
  AlarmClockPlus,
  Plus,
  Trash2,
  X,
} from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  Button,
  Card,
  Chip,
  FieldLabel,
  Input,
  SegmentedControl,
  Sheet,
  SheetScroll,
  TimeInput,
} from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { localDate, nextYmd, todayLocal, tomorrowLocal } from "@/lib/dates";
import { ENTRY_META, TYPES_BY_MODE, type EntryType, type Mode } from "@/lib/entries";
import {
  dayReminderInFuture,
  dayReminderPresets,
  dayReminderStatus,
  formatTime,
  sortDayReminders,
  type DayReminderStatus,
} from "@/lib/reminders";
import type { DayReminder, LogRow } from "@/lib/types";
import { getPushState as getPushStateFor } from "@/push/register";
import { supabase } from "@/supabase/client";

export type DayRemindersHandle = { open: () => void };

/** Push on this device: known on/off, or still being resolved. */
type PushKnown = "on" | "off" | "loading";

/** Push on this device for this member, folded to the two answers this
 *  section cares about: anything short of "on" (denied, simulator, off) means
 *  the reminder can only show here on Today. */
async function getPushState(userId: string): Promise<"on" | "off"> {
  return (await getPushStateFor(userId)) === "on" ? "on" : "off";
}


/**
 * One-time reminders for later today (or tomorrow), shown at the top of the
 * Today list. Owns its rows and its sheet; the speed dial reaches in through
 * the `ref` to open the sheet, so both doors share one piece of state.
 *
 * Status is driven by the row (sent_at / skipped_at) and by the same
 * "already logged" rule the cron uses, never by the clock alone: a check mark
 * must mean something actually happened. "Sent" is only claimed when this
 * device has push on; otherwise the row just says the time has passed.
 *
 * Ported from reference/web-pwa/components/DayReminders.tsx.
 */
export function DayReminders({
  ref,
  userId,
  tz,
  mode,
  initial,
  entries,
}: {
  ref?: Ref<DayRemindersHandle>;
  userId: string;
  tz: string;
  mode: Mode;
  initial: DayReminder[];
  /** The user's recent entries, for the live "Logged" preview. */
  entries: LogRow[];
}) {
  const c = useTheme();
  const [reminders, setReminders] = useState<DayReminder[]>(initial);
  // The web seeded this from the server clock so SSR and the client agreed;
  // native has no server render, so the device clock at mount is the seed.
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  // Bumped on every open so the sheet remounts with fresh time-of-day
  // defaults, while a closing sheet keeps its instance for the exit slide.
  const [sheetKey, setSheetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Re-read on mount, on sheet open and on foreground return: the Settings
  // switch, the OS permission and the signed-in member can all change under
  // a resident Today tab, so nothing here is cached (the web cached its
  // service-worker answer; the native check is local prefs and fast).
  const [push, setPush] = useState<PushKnown>("loading");
  // Ids mid-delete: a refetch that lands after the optimistic removal must
  // not bring the row back. The mutation counter covers the other order: a
  // refetch that STARTED before a delete or add and lands after it is stale.
  const deleting = useRef(new Set<string>());
  const mutations = useRef(0);
  // Latest rows for the timer, which must not re-arm on every change.
  const latest = useRef(reminders);
  useEffect(() => {
    latest.current = reminders;
  }, [reminders]);

  const checkPush = useCallback(() => {
    getPushState(userId)
      .then(setPush)
      .catch(() => setPush("off"));
  }, [userId]);
  // Resolve push state at mount, well before the sheet opens, so the
  // warning is known up front instead of shifting the layout under a thumb.
  useEffect(() => {
    checkPush();
  }, [checkPush]);

  const openSheet = useCallback(() => {
    checkPush();
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }, [checkPush]);
  useImperativeHandle(ref, () => ({ open: openSheet }), [openSheet]);

  const refetch = useCallback(async () => {
    const seq = mutations.current;
    const { data, error } = await supabase
      .from("day_reminders")
      .select("*")
      .eq("user_id", userId)
      .gte("remind_on", todayLocal(tz))
      .lte("remind_on", tomorrowLocal(tz))
      .order("remind_on", { ascending: true })
      .order("time", { ascending: true });
    if (error || !data || seq !== mutations.current) return;
    setReminders((data as DayReminder[]).filter((r) => !deleting.current.has(r.id)));
  }, [userId, tz]);

  // A profile timezone change moves the today/tomorrow window while this
  // section stays mounted (Today sits under the Settings stack screen) and
  // `initial` is read once, so the parent's refetch for the new window never
  // reaches it. The web remounted with fresh server props on the way back;
  // native refetches here. Skips the mount: the parent fetched that window.
  const seenTz = useRef(tz);
  useEffect(() => {
    if (seenTz.current === tz) return;
    seenTz.current = tz;
    void refetch();
  }, [tz, refetch]);

  // Minute-aligned clock. Each tick also refetches when it matters: the
  // local date rolled over while the screen stayed mounted (yesterday's rows
  // go, tomorrow's become today's), or a row is due and the job should have
  // marked it by now. Foreground return refetches unconditionally: the OS
  // suspends JS timers in the background, so the first tick after a return
  // can be minutes or hours late. (The web listened to visibilitychange and
  // focus; AppState "active" is the one native event that covers both.)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastYmd = todayLocal(tz);
    const tick = (force: boolean) => {
      const t = Date.now();
      setNow(t);
      const ymd = localDate(t, tz);
      const due = latest.current.some(
        (r) => !r.sent_at && !r.skipped_at && new Date(r.due_at).getTime() <= t,
      );
      if (force || due || ymd !== lastYmd) {
        lastYmd = ymd;
        void refetch();
      }
    };
    const arm = () => {
      timer = setTimeout(
        () => {
          tick(false);
          arm();
        },
        60_000 - (Date.now() % 60_000) + 50,
      );
    };
    arm();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        tick(true);
        checkPush();
      }
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [refetch, tz, checkPush]);

  const remove = async (id: string) => {
    const prev = reminders;
    mutations.current += 1;
    deleting.current.add(id);
    setReminders((p) => p.filter((r) => r.id !== id));
    setError(null);
    const { error } = await supabase.from("day_reminders").delete().eq("id", id);
    deleting.current.delete(id);
    if (error) {
      setReminders(prev);
      setError("Couldn’t remove that reminder.");
    }
  };

  const today = localDate(now, tz);
  // Yesterday's rows drop out at midnight even before the refetch lands.
  const visible = sortDayReminders(reminders).filter((r) => r.remind_on >= today);
  const loggedToday = new Set(
    entries.filter((e) => localDate(e.logged_at, tz) === today).map((e) => e.entry_type),
  );

  return (
    <View style={styles.section}>
      {visible.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={openSheet}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Card style={styles.door}>
            <View style={[styles.iconBox, { backgroundColor: c.surface2 }]}>
              <AlarmClockPlus size={20} color={c.muted} />
            </View>
            <View style={styles.grow}>
              <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>Remind me</Text>
              <Text style={[Type.footnote, { color: c.muted }]}>
                A one-time nudge for later today or tomorrow.
              </Text>
            </View>
          </Card>
        </Pressable>
      ) : (
        <>
          <View style={styles.listHeader}>
            <Text style={[Type.footnote, styles.caption, { color: c.faint }]}>One-time reminders</Text>
            <Pressable
              accessibilityRole="button"
              onPress={openSheet}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Plus size={16} color={c.accent} strokeWidth={2.5} />
              <Text style={[Type.subhead, styles.semibold, { color: c.accent }]}>Add</Text>
            </Pressable>
          </View>
          <View style={styles.rows}>
            {visible.map((r) => (
              <DayReminderRow
                key={r.id}
                reminder={r}
                status={dayReminderStatus(r, entries, now, tz)}
                tomorrow={r.remind_on > today}
                pushOn={push === "on"}
                onDelete={() => remove(r.id)}
              />
            ))}
          </View>
        </>
      )}

      {error && <Text style={[Type.footnote, styles.sectionError, { color: c.danger }]}>{error}</Text>}

      <DayReminderSheet
        key={sheetKey}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        userId={userId}
        tz={tz}
        mode={mode}
        loggedTypes={loggedToday}
        push={push}
        onSaved={(saved) => {
          mutations.current += 1;
          setReminders((p) => [...p, saved]);
        }}
      />
    </View>
  );
}

function DayReminderRow({
  reminder: r,
  status,
  tomorrow,
  pushOn,
  onDelete,
}: {
  reminder: DayReminder;
  status: DayReminderStatus;
  tomorrow: boolean;
  pushOn: boolean;
  onDelete: () => void;
}) {
  const c = useTheme();
  const done = status === "sent" || status === "logged";
  const label = r.entry_type ? ENTRY_META[r.entry_type].label : null;
  const what = [label, r.note].filter(Boolean).join(" · ") || "A little Quran";
  const Icon = done ? AlarmClockCheck : AlarmClock;
  // Honest states: "Sent" only when this device can receive it; "Logged" when
  // the thing it was for got done first; "Due" while the job is still on it.
  const suffix =
    status === "logged"
      ? "Logged"
      : status === "sent"
        ? pushOn
          ? "Sent"
          : "Time passed"
        : status === "due"
          ? "Due"
          : null;
  const well = done
    ? { bg: c.surface2, fg: c.faint }
    : status === "due"
      ? { bg: c.warnTint, fg: c.warn }
      : { bg: c.accentTint, fg: c.accent };
  return (
    <Card style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: well.bg }]}>
        <Icon size={20} color={well.fg} />
      </View>
      <View style={styles.grow}>
        <View style={styles.timeLine}>
          <Text
            style={[
              Type.callout,
              styles.semibold,
              styles.tabular,
              { color: done ? c.faint : c.foreground },
              done && styles.strike,
            ]}
          >
            {tomorrow ? "Tomorrow " : ""}
            {formatTime(r.time)}
          </Text>
          {suffix && (
            <Text style={[Type.footnote, styles.medium, { color: status === "due" ? c.warn : c.faint }]}>
              {suffix}
            </Text>
          )}
        </View>
        <Text numberOfLines={1} style={[Type.footnote, { color: c.muted }]}>
          {what}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={done ? "Remove reminder" : "Cancel reminder"}
        onPress={onDelete}
        hitSlop={6}
        style={({ pressed }) => [styles.trash, pressed && { backgroundColor: c.dangerTint }]}
      >
        {({ pressed }) => <Trash2 size={16} color={pressed ? c.danger : c.faint} />}
      </Pressable>
    </Card>
  );
}

const PUSH_OFF_NOTE: Record<Exclude<PushKnown, "on" | "loading">, string> = {
  off: "Notifications aren’t set up on this phone yet, so this will only show here on Today.",
};

export function DayReminderSheet({
  open,
  onClose,
  userId,
  tz,
  mode,
  loggedTypes,
  push,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  tz: string;
  mode: Mode;
  /** Entry types already logged today (picks the first one still to do). */
  loggedTypes: Set<EntryType>;
  push: PushKnown;
  onSaved: (r: DayReminder) => void;
}) {
  const c = useTheme();
  const types = TYPES_BY_MODE[mode];
  const pickType = types.length > 1; // readers are implicitly "reading"

  // Pinned once per open (the parent keys this component on each open): the
  // dates behind "Today" and "Tomorrow", and the quick picks. A save that
  // straddles midnight still targets the day the member was looking at.
  const [base] = useState(() => {
    const nowMs = Date.now();
    const today = localDate(nowMs, tz);
    return {
      today,
      tomorrow: nextYmd(today),
      presets: dayReminderPresets(nowMs, tz),
    };
  });
  const initial = base.presets.find((p) => p.label === "In 1 hour") ?? base.presets[0];
  const [ymd, setYmd] = useState(initial.ymd);
  const [time, setTime] = useState(initial.time);
  const [type, setType] = useState<EntryType | null>(() =>
    pickType ? (types.find((t) => !loggedTypes.has(t)) ?? null) : types[0],
  );
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceTz] = useState(() =>
    typeof Intl === "undefined" ? tz : Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  const save = async () => {
    if (!time) {
      setError("Pick a time.");
      return;
    }
    if (!dayReminderInFuture(ymd, time, Date.now(), tz)) {
      setError("Pick a time that hasn’t passed yet.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("day_reminders")
      .insert({
        user_id: userId,
        remind_on: ymd,
        time,
        entry_type: type,
        note: note.trim() || null,
      })
      .select("*")
      .single();
    setBusy(false);
    if (error || !data) {
      const msg = error?.message ?? "";
      setError(
        /already passed|today or tomorrow/i.test(msg)
          ? "That time has already passed. Pick a later one."
          : /plenty of reminders/i.test(msg)
            ? "That’s plenty of reminders for one day. Clear a few first."
            : "Couldn’t set that reminder. Try again.",
      );
      return;
    }
    onSaved(data as DayReminder);
    onClose();
  };

  // The sheet is a Modal, so a route change underneath it would leave the
  // sheet floating over the Profile tab: close first, then navigate.
  const goToSettings = () => {
    onClose();
    router.push("/profile?section=notifications");
  };

  return (
    <Sheet open={open} onClose={onClose} dragAnywhere={false}>
        {/* The Sheet stays above the keyboard; this shrinks and scrolls to
            the focused field. */}
        <SheetScroll contentContainerStyle={styles.sheetBody}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[Type.title2, { color: c.foreground }]}>
              Remind me
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: c.surface2 }]}
            >
              <X size={16} color={c.muted} />
            </Pressable>
          </View>
          <Text style={[Type.footnote, styles.sheetLede, { color: c.muted }]}>
            A one-time nudge. Your daily reminders live in Settings.
          </Text>

          <FieldLabel>When</FieldLabel>
          <SegmentedControl
            segments={[
              { value: base.today, label: "Today" },
              { value: base.tomorrow, label: "Tomorrow" },
            ]}
            value={ymd}
            onChange={setYmd}
          />
          <View style={styles.chips}>
            {base.presets.map((p) => {
              const on = p.ymd === ymd && p.time === time;
              return (
                <Chip
                  key={p.label}
                  active={on}
                  variant="solid"
                  size="lg"
                  onPress={() => {
                    setYmd(p.ymd);
                    setTime(p.time);
                  }}
                >
                  {p.label}
                </Chip>
              );
            })}
          </View>
          <TimeInput value={time} onChange={setTime} accessibilityLabel="Time" style={styles.mt3} />
          {deviceTz !== tz && (
            <Text style={[Type.footnote, styles.helper, { color: c.faint }]}>Times are in {tz}.</Text>
          )}

          {pickType && (
            <View style={styles.mt5}>
              <FieldLabel>What for</FieldLabel>
              <View style={styles.chipsFlush}>
                {types.map((t) => (
                  <Chip key={t} active={type === t} variant="solid" size="lg" onPress={() => setType(t)}>
                    {ENTRY_META[t].label}
                  </Chip>
                ))}
                <Chip active={type === null} variant="solid" size="lg" onPress={() => setType(null)}>
                  Anything
                </Chip>
              </View>
            </View>
          )}
          {type && (
            <Text style={[Type.footnote, styles.typeNote, { color: c.faint }]}>
              If you log {ENTRY_META[type].label} before then, this stays quiet.
            </Text>
          )}

          <View style={styles.mt5}>
            {showNote ? (
              <>
                <FieldLabel>Note</FieldLabel>
                <Input
                  placeholder="After Isha, Juz 5…"
                  value={note}
                  maxLength={120}
                  onChangeText={setNote}
                  autoFocus
                  returnKeyType="done"
                />
                <Text style={[Type.footnote, styles.helper, { color: c.faint }]}>
                  This becomes the notification text.
                </Text>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowNote(true)}
                style={({ pressed }) => [styles.noteLink, pressed && styles.pressed]}
              >
                <Plus size={16} color={c.accent} strokeWidth={2.5} />
                <Text style={[Type.subhead, styles.medium, { color: c.accent }]}>Add a note</Text>
              </Pressable>
            )}
          </View>

          {push !== "loading" && push !== "on" && (
            <View
              style={[
                styles.pushBox,
                // Web: border-warn/30 (30% alpha, "4D" in hex) on the warn tint.
                { backgroundColor: c.warnTint, borderColor: `${c.warn}4D` },
              ]}
            >
              <Text style={[Type.footnote, { color: c.foreground }]}>
                {PUSH_OFF_NOTE[push]}{" "}
                <Text
                  accessibilityRole="link"
                  onPress={goToSettings}
                  style={[styles.semibold, { color: c.accent }]}
                >
                  Turn them on in Settings.
                </Text>
              </Text>
            </View>
          )}

          {error && <Text style={[Type.footnote, styles.mt3, { color: c.danger }]}>{error}</Text>}

          <Button fullWidth style={styles.mt6} onPress={save} loading={busy}>
            Set reminder
          </Button>
        </SheetScroll>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  section: { paddingBottom: 8 },
  pressed: { opacity: 0.85 },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  tabular: { fontVariant: ["tabular-nums"] },
  strike: { textDecorationLine: "line-through" },
  // Door and rows: web rounded-2xl bg-surface p-3.5 shadow-e1, flex gap-3.
  door: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rows: { gap: 10 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  caption: { fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.65 },
  link: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  trash: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionError: { marginTop: 8, paddingHorizontal: 4 },
  // Sheet
  sheetBody: { paddingHorizontal: 20, paddingTop: 8 },
  sheetHeader: {
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
  sheetLede: { marginBottom: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chipsFlush: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  helper: { marginTop: 6, paddingHorizontal: 4 },
  typeNote: { marginTop: 8, paddingHorizontal: 4 },
  noteLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  pushBox: {
    marginTop: 20,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  mt3: { marginTop: 12 },
  mt5: { marginTop: 20 },
  mt6: { marginTop: 24 },
});
