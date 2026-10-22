import { Pencil } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { TimezonePicker, detectTimezone, isValidTimezone } from "@/components/TimezonePicker";
import {
  Avatar,
  Button,
  Card,
  FieldLabel,
  Input,
  SegmentedControl,
  Sheet,
  SheetFooter,
  SheetScroll,
} from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { ENTRY_META, TYPES_BY_MODE, type Mode } from "@/lib/entries";
import { DEFAULT_MUSHAF, MUSHAF_OPTIONS } from "@/lib/mushaf";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

const MODE_SEGMENTS: { value: Mode; label: string }[] = [
  { value: "hifz", label: "Memorizing" },
  { value: "reading", label: "Reading" },
];

/**
 * Ported from reference/web-pwa/components/ProfileSection.tsx. The card shows
 * the session profile (it is the identity card at the top of the Profile tab,
 * which absorbed the old Settings screen, so it carries the avatar, mode and
 * mushaf pills too); tapping it opens the sheet, which edits name, mode and time zone. The web
 * re-rendered the server page after saving (router.refresh); native awaits
 * refreshProfile() so the gate, headers and the log sheet see the new mode.
 *
 * Time zone diverges from the web on purpose: the typed field stays (an
 * escape hatch for zones missing from the picker's fallback list), the
 * picker is added because members travel (docs/HANDOFF.md § Working notes),
 * and the value is validated before it is saved. `profiles.timezone` feeds
 * Today's date math and the reminder cron, so a bad zone crashes the tab and
 * aborts the cron run for the whole circle.
 */

/** The footnote links under the time zone are 18 pt tall: grow the touch
 *  area to about 44 without moving them (8 sideways keeps the two apart). */
const LINK_SLOP = { top: 13, bottom: 13, left: 8, right: 8 };
export function ProfileSection() {
  const c = useTheme();
  const { user, profile, refreshProfile } = useSession();

  const displayName = profile?.display_name ?? "You";
  const mushafId = profile?.mushaf ?? DEFAULT_MUSHAF;
  const mushafLabel = MUSHAF_OPTIONS.find((o) => o.id === mushafId)?.label ?? mushafId;
  const currentMode: Mode = profile?.mode ?? "reading";
  const currentTz = profile?.timezone ?? detectTimezone();

  const [open, setOpen] = useState(false);
  const [tzOpen, setTzOpen] = useState(false);
  const [name, setName] = useState(displayName);
  const [mode, setMode] = useState<Mode>(currentMode);
  const [timezone, setTimezone] = useState(currentTz);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The device's zone; members travel, so it is offered next to the saved one.
  const detected = detectTimezone();

  // Seed the form from the profile each time the sheet opens (the web
  // remounted with fresh server props; native keeps the component mounted).
  const openSheet = () => {
    setName(displayName);
    setMode(currentMode);
    setTimezone(currentTz);
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!name.trim()) {
      setError("Name can’t be empty.");
      return;
    }
    const tz = timezone.trim();
    if (!isValidTimezone(tz)) {
      setError(
        "That time zone isn’t recognized. Pick one from the list, use an IANA name like America/Toronto, or tap Use detected.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name.trim(), mode, timezone: tz })
      .eq("id", user.id);
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    setOpen(false);
    await refreshProfile();
    setSaving(false);
  };

  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={openSheet}>
        {({ pressed }) => (
          <Card style={pressed && styles.pressed}>
            <View style={styles.identity}>
              <Avatar name={displayName} src={profile?.avatar_url} size={72} />
              <View style={styles.grow}>
                <Text numberOfLines={1} style={[Type.title2, { color: c.foreground }]}>
                  {displayName}
                </Text>
                {user?.email ? (
                  <Text numberOfLines={1} style={[Type.footnote, { color: c.muted }]}>
                    {user.email}
                  </Text>
                ) : null}
              </View>
              <Pencil size={16} color={c.faint} />
            </View>
            <View style={styles.pills}>
              <View style={[styles.pill, { backgroundColor: c.surface2 }]}>
                <Text style={[Type.caption, { color: c.muted }]}>
                  {currentMode === "hifz" ? "Memorizing (Hifz)" : "Reading"}
                </Text>
              </View>
              <View style={[styles.pill, { backgroundColor: c.surface2 }]}>
                <Text style={[Type.caption, { color: c.muted }]}>{mushafLabel}</Text>
              </View>
            </View>
            {/* The entry types a mode logs. Reading mode logs only Reading,
                which the pill above already says, so the line would just
                repeat it. */}
            {TYPES_BY_MODE[currentMode].length > 1 && (
              <Text style={[Type.footnote, styles.types, { color: c.faint }]}>
                {TYPES_BY_MODE[currentMode].map((t) => ENTRY_META[t].label).join(" · ")}
              </Text>
            )}
          </Card>
        )}
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)} dragAnywhere={false}>
          {/* The Sheet stays above the keyboard; this shrinks and scrolls to
              the focused field. */}
          <SheetScroll contentContainerStyle={styles.sheetContent} bounces={false}>
            <Text style={[Type.title2, styles.title, { color: c.foreground }]}>Edit profile</Text>

            <FieldLabel>Display name</FieldLabel>
            <Input
              accessibilityLabel="Display name"
              value={name}
              onChangeText={setName}
              maxLength={40}
              autoCapitalize="words"
              returnKeyType="done"
            />

            <View style={styles.block}>
              <FieldLabel>Mode</FieldLabel>
              <SegmentedControl<Mode> segments={MODE_SEGMENTS} value={mode} onChange={setMode} />
              <Text style={[Type.footnote, styles.helper, { color: c.faint }]}>
                Changes your log options and default charts.
              </Text>
            </View>

            <View style={styles.block}>
              <FieldLabel>Time zone</FieldLabel>
              <Input
                accessibilityLabel="Time zone"
                value={timezone}
                onChangeText={setTimezone}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
              <View style={styles.tzActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint="Opens the time zone picker"
                  hitSlop={LINK_SLOP}
                  onPress={() => setTzOpen(true)}
                >
                  <Text style={[Type.footnote, styles.medium, { color: c.accent }]}>
                    Choose from list
                  </Text>
                </Pressable>
                {detected !== timezone && (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={LINK_SLOP}
                    onPress={() => setTimezone(detected)}
                  >
                    <Text style={[Type.footnote, styles.medium, { color: c.accent }]}>
                      Use detected ({detected})
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>

          </SheetScroll>
          <SheetFooter>
            {error && (
              <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>
            )}
            <View style={styles.actions}>
              <Button variant="secondary" onPress={() => setOpen(false)}>
                Cancel
              </Button>
              <Button fullWidth style={styles.grow} onPress={() => void save()} loading={saving}>
                Save
              </Button>
            </View>
          </SheetFooter>

        {/* Rendered inside the sheet so it stacks as a nested Modal on both
            platforms (a sibling Modal would fight the open one on iOS). */}
        <TimezonePicker
          open={tzOpen}
          onClose={() => setTzOpen(false)}
          value={timezone}
          onChange={setTimezone}
        />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 16 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  types: { marginTop: 8 },
  pressed: { opacity: 0.85 },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  sheetContent: { paddingHorizontal: 20, paddingTop: 8 },
  title: { marginBottom: 20 },
  block: { marginTop: 20 },
  helper: { marginTop: 8, paddingHorizontal: 4 },
  tzActions: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 8 },
  error: { marginTop: 12 },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
});
