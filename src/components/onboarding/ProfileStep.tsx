import { Check, ChevronDown, Globe } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { TimezonePicker, detectTimezone } from "@/components/TimezonePicker";
import { FieldLabel, Input, Switch, TimeInput } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { MUSHAF_OPTIONS, type MushafId } from "@/lib/mushaf";

export type ProfileDraft = {
  name: string;
  timezone: string;
  mushaf: MushafId;
  reminderOn: boolean;
  reminderTime: string;
};

/**
 * Step 2 of onboarding: name, time zone, mushaf, first daily reminder.
 * Ported from reference/web-pwa/app/onboarding/OnboardingFlow.tsx with two
 * owner-decided additions (docs/HANDOFF.md Phase 1): the zone is changeable
 * (members travel) and the mushaf is chosen here instead of only in Settings
 * (reference/web-pwa/components/MushafSelect.tsx, same rows).
 */
export function ProfileStep({
  draft,
  onChange,
}: {
  draft: ProfileDraft;
  onChange: (patch: Partial<ProfileDraft>) => void;
}) {
  const c = useTheme();
  const [tzOpen, setTzOpen] = useState(false);
  // "Detected automatically" only while the zone is still the device's.
  const detected = detectTimezone();
  const tzHelper =
    draft.timezone === detected
      ? "Detected automatically · used for reminders and streaks."
      : "Tap to change · used for reminders and streaks.";

  return (
    <>
      <Text style={[Type.title1, styles.title, { color: c.foreground }]}>Your profile</Text>
      <Text style={[Type.callout, styles.intro, { color: c.muted }]}>
        How you’ll show up to your circle.
      </Text>

      <View style={styles.fields}>
        <View>
          <FieldLabel>Display name</FieldLabel>
          <Input
            value={draft.name}
            onChangeText={(name) => onChange({ name })}
            placeholder="Your name"
            autoFocus
            maxLength={40}
            autoComplete="name"
            textContentType="name"
            returnKeyType="done"
          />
        </View>

        <View>
          <FieldLabel>Time zone</FieldLabel>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Time zone, ${draft.timezone.replace(/_/g, " ")}`}
            accessibilityHint="Opens the time zone picker"
            onPress={() => setTzOpen(true)}
            style={({ pressed }) => [
              styles.tzField,
              { backgroundColor: c.surface, borderColor: pressed ? c.accent : c.border },
            ]}
          >
            <Globe size={16} color={c.faint} />
            <Text style={[Type.callout, styles.tzName, { color: c.foreground }]} numberOfLines={1}>
              {draft.timezone.replace(/_/g, " ")}
            </Text>
            <ChevronDown size={16} color={c.faint} />
          </Pressable>
          <Text style={[Type.footnote, styles.helper, { color: c.faint }]}>{tzHelper}</Text>
        </View>

        <View>
          <FieldLabel>Mushaf</FieldLabel>
          <View style={styles.mushafRows}>
            {MUSHAF_OPTIONS.map((o) => {
              const active = draft.mushaf === o.id;
              return (
                <Pressable
                  key={o.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onChange({ mushaf: o.id })}
                  style={[
                    styles.mushafRow,
                    active
                      ? { borderColor: c.accent, backgroundColor: c.accentTint }
                      : { borderColor: c.border, backgroundColor: c.surface2 },
                  ]}
                >
                  <View style={styles.mushafText}>
                    <Text style={[Type.subhead, { color: c.foreground }]}>{o.label}</Text>
                    <Text style={[Type.caption, styles.mushafSub, { color: c.faint }]}>{o.sub}</Text>
                  </View>
                  {active && <Check size={20} color={c.accent} />}
                </Pressable>
              );
            })}
          </View>
          <Text style={[Type.caption, styles.helper, { color: c.faint }]}>
            Sets how your reading page maps to juz & surah. Pages count the same either
            way.
          </Text>
        </View>

        <View>
          <FieldLabel>Daily reminder</FieldLabel>
          <View style={styles.reminderRow}>
            <Switch
              value={draft.reminderOn}
              onValueChange={(reminderOn) => onChange({ reminderOn })}
              accessibilityLabel="Daily reminder"
            />
            <TimeInput
              value={draft.reminderTime}
              onChange={(reminderTime) => onChange({ reminderTime })}
              disabled={!draft.reminderOn}
              accessibilityLabel="Reminder time"
              style={styles.grow}
            />
          </View>
          <Text style={[Type.footnote, styles.helper, { color: c.faint }]}>
            One gentle nudge a day, at your local time.
          </Text>
        </View>
      </View>

      <TimezonePicker
        open={tzOpen}
        onClose={() => setTzOpen(false)}
        value={draft.timezone}
        onChange={(timezone) => onChange({ timezone })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 8 },
  intro: { marginTop: 8 },
  // web: mt-7 space-y-5
  fields: { marginTop: 28, gap: 20 },
  // Same frame as the kit Input so the row reads as a field.
  tzField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tzName: { flex: 1 },
  // web: mt-1.5 px-1
  helper: { marginTop: 6, paddingHorizontal: 4 },
  // web: space-y-2
  mushafRows: { gap: 8 },
  mushafRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 12,
  },
  mushafText: { flex: 1, minWidth: 0 },
  mushafSub: { fontWeight: "400" },
  reminderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
});
