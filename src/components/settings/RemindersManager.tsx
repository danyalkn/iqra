import { Bell, BellOff, Clock, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Card, Chip, FieldLabel, Sheet, TimeInput } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getMyReminders } from "@/lib/data";
import { DAY_INITIALS, daysSummary, formatTime } from "@/lib/reminders";
import type { Reminder } from "@/lib/types";
import { supabase } from "@/supabase/client";

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

/**
 * Recurring reminders (docs/DECISIONS.md § Reminders: the `reminders` table,
 * one row per time + days-of-week, fired in the profile's time zone). Ported
 * from reference/web-pwa/components/RemindersManager.tsx. The web page loaded
 * the rows on the server; native loads them on mount.
 */
export function RemindersManager({ userId }: { userId: string }) {
  const c = useTheme();
  // null while the first load is in flight, so the empty state never flashes.
  const [reminders, setReminders] = useState<Reminder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The sheet instance. The web keyed the sheet by "new" / id / "closed" so
  // each open remounted it with a fresh form; a remount on close would also
  // unmount the native Modal before its exit animation, so the key only
  // changes on open and the target stays put through the close.
  const [sheet, setSheet] = useState<{ key: number; reminder: Reminder | null; open: boolean }>({
    key: 0,
    reminder: null,
    open: false,
  });

  useEffect(() => {
    let cancelled = false;
    getMyReminders(supabase, userId).then((rows) => {
      if (!cancelled) setReminders(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const openSheet = (reminder: Reminder | null) =>
    setSheet((s) => ({ key: s.key + 1, reminder, open: true }));
  const closeSheet = () => setSheet((s) => ({ ...s, open: false }));

  const sortByTime = (rs: Reminder[]) => [...rs].sort((a, b) => a.time.localeCompare(b.time));

  const toggle = async (r: Reminder) => {
    const next = !r.enabled;
    setReminders((prev) => prev && prev.map((x) => (x.id === r.id ? { ...x, enabled: next } : x)));
    const { error } = await supabase.from("reminders").update({ enabled: next }).eq("id", r.id);
    if (error) {
      setReminders(
        (prev) => prev && prev.map((x) => (x.id === r.id ? { ...x, enabled: !next } : x)),
      );
      setError("Couldn’t update that reminder.");
    }
  };

  return (
    <View>
      <View style={styles.header}>
        <FieldLabel style={styles.headerLabel}>Daily reminders</FieldLabel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add reminder"
          onPress={() => openSheet(null)}
          hitSlop={8}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        >
          <Plus size={16} color={c.accent} strokeWidth={2.5} />
          <Text style={[Type.subhead, styles.semibold, { color: c.accent }]}>Add</Text>
        </Pressable>
      </View>

      {error && <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>}

      {reminders === null ? (
        <Card style={styles.empty}>
          <ActivityIndicator color={c.muted} />
        </Card>
      ) : reminders.length === 0 ? (
        <Card style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.accentTint }]}>
            <Bell size={20} color={c.accent} />
          </View>
          <Text style={[Type.callout, styles.semibold, styles.emptyTitle, { color: c.foreground }]}>
            No reminders yet
          </Text>
          <Text style={[Type.footnote, styles.emptyNote, { color: c.muted }]}>
            Add a nudge or two so you don’t forget to log.
          </Text>
        </Card>
      ) : (
        <View style={styles.list}>
          {sortByTime(reminders).map((r) => (
            <Card key={r.id} style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${formatTime(r.time)} reminder`}
                onPress={() => openSheet(r)}
                style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
              >
                <View
                  style={[
                    styles.rowIcon,
                    { backgroundColor: r.enabled ? c.accentTint : c.surface2 },
                  ]}
                >
                  <Clock size={20} color={r.enabled ? c.accent : c.faint} />
                </View>
                <View style={styles.grow}>
                  <Text
                    style={[
                      Type.callout,
                      styles.semibold,
                      styles.tabular,
                      { color: r.enabled ? c.foreground : c.faint },
                      !r.enabled && styles.strike,
                    ]}
                  >
                    {formatTime(r.time)}
                  </Text>
                  <Text style={[Type.footnote, { color: c.muted }]}>{daysSummary(r.days)}</Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: r.enabled }}
                accessibilityLabel={r.enabled ? "Disable" : "Enable"}
                onPress={() => void toggle(r)}
                style={({ pressed }) => [
                  styles.toggle,
                  pressed && { backgroundColor: c.surface2 },
                ]}
              >
                {r.enabled ? (
                  <Bell size={18} color={c.accent} />
                ) : (
                  <BellOff size={18} color={c.muted} />
                )}
              </Pressable>
            </Card>
          ))}
        </View>
      )}

      <Text style={[Type.footnote, styles.helper, { color: c.faint }]}>
        Need a one-time nudge for later today or tomorrow? Set it from the Today page.
      </Text>

      <ReminderSheet
        key={sheet.key}
        userId={userId}
        reminder={sheet.reminder}
        open={sheet.open}
        onClose={closeSheet}
        onSaved={(saved, isNew) => {
          setReminders((prev) =>
            isNew
              ? [...(prev ?? []), saved]
              : (prev ?? []).map((x) => (x.id === saved.id ? saved : x)),
          );
          closeSheet();
        }}
        onDeleted={(id) => {
          setReminders((prev) => (prev ?? []).filter((x) => x.id !== id));
          closeSheet();
        }}
      />
    </View>
  );
}

export function ReminderSheet({
  userId,
  reminder,
  open,
  onClose,
  onSaved,
  onDeleted,
}: {
  userId: string;
  reminder: Reminder | null;
  open: boolean;
  onClose: () => void;
  onSaved: (r: Reminder, isNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const c = useTheme();
  const [time, setTime] = useState(reminder ? reminder.time.slice(0, 5) : "06:00");
  const [days, setDays] = useState<number[]>(reminder ? reminder.days : ALL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const save = async () => {
    if (days.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = { time, days: [...days].sort((a, b) => a - b), user_id: userId };

    if (reminder) {
      const { data, error } = await supabase
        .from("reminders")
        .update({ time: payload.time, days: payload.days })
        .eq("id", reminder.id)
        .select("*")
        .single();
      setBusy(false);
      if (error || !data) return setError("Couldn’t save. Try again.");
      onSaved(data as Reminder, false);
    } else {
      const { data, error } = await supabase
        .from("reminders")
        .insert({ ...payload, enabled: true })
        .select("*")
        .single();
      setBusy(false);
      if (error || !data) return setError("Couldn’t save. Try again.");
      onSaved(data as Reminder, true);
    }
  };

  const remove = async () => {
    if (!reminder) return;
    setBusy(true);
    const { error } = await supabase.from("reminders").delete().eq("id", reminder.id);
    setBusy(false);
    if (error) return setError("Couldn’t delete.");
    onDeleted(reminder.id);
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <View style={styles.sheetContent}>
        <Text style={[Type.title2, styles.title, { color: c.foreground }]}>
          {reminder ? "Edit reminder" : "New reminder"}
        </Text>

        <FieldLabel>Time</FieldLabel>
        <TimeInput value={time} onChange={setTime} accessibilityLabel="Time" />

        <View style={styles.block}>
          <FieldLabel>Repeat on</FieldLabel>
          <View style={styles.days}>
            {DAY_INITIALS.map((label, d) => {
              const on = days.includes(d);
              return (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => toggleDay(d)}
                  style={({ pressed }) => [
                    styles.day,
                    { backgroundColor: on ? c.accent : c.surface2 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[Type.subhead, styles.semibold, { color: on ? c.onAccent : c.muted }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.quick}>
            {/* Plain buttons in the chip look (the web used bare surface-2 pills). */}
            <Chip active={false} size="md" onPress={() => setDays(ALL)}>
              Daily
            </Chip>
            <Chip active={false} size="md" onPress={() => setDays(WEEKDAYS)}>
              Weekdays
            </Chip>
          </View>
        </View>

        {error && <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>}

        <View style={styles.actions}>
          {reminder && (
            <Button
              variant="secondary"
              accessibilityLabel="Delete reminder"
              onPress={() => void remove()}
              disabled={busy}
            >
              <Trash2 size={16} color={c.foreground} />
            </Button>
          )}
          <Button fullWidth style={styles.grow} onPress={() => void save()} loading={busy}>
            {reminder ? "Save" : "Add reminder"}
          </Button>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  headerLabel: { marginBottom: 0 },
  add: { flexDirection: "row", alignItems: "center", gap: 4 },
  pressed: { opacity: 0.7 },
  error: { marginBottom: 8 },
  empty: { alignItems: "center", padding: 20 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { marginTop: 12 },
  emptyNote: { marginTop: 4, textAlign: "center" },
  list: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  tabular: { fontVariant: ["tabular-nums"] },
  strike: { textDecorationLine: "line-through" },
  toggle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  helper: { marginTop: 8, paddingHorizontal: 4 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 8 },
  title: { marginBottom: 20 },
  block: { marginTop: 20 },
  days: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  day: {
    flex: 1,
    height: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  quick: { flexDirection: "row", gap: 8, marginTop: 8 },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
});
