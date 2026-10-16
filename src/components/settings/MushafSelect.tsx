import { BookOpen, Check } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_MUSHAF, MUSHAF_OPTIONS, type MushafId } from "@/lib/mushaf";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

/**
 * Pick the mushaf you read - drives the reading bookmark's page→juz/surah map
 * and page range. Stored on the profile so it follows you across devices.
 * Ported from reference/web-pwa/components/MushafSelect.tsx.
 *
 * The shown value is the session profile's, overlaid by the choice in flight:
 * that gives the web's optimistic update for free, rolls back by simply
 * dropping the overlay on error, and after a successful write awaits
 * refreshProfile() because the log sheet stamps entries with the session
 * profile's mushaf (docs/DECISIONS.md § Logging).
 */
export function MushafSelect() {
  const c = useTheme();
  const { user, profile, refreshProfile } = useSession();
  const [saving, setSaving] = useState<MushafId | null>(null);
  const value: MushafId = saving ?? profile?.mushaf ?? DEFAULT_MUSHAF;

  const choose = async (next: MushafId) => {
    if (!user || next === value || saving) return;
    setSaving(next);
    const { error } = await supabase.from("profiles").update({ mushaf: next }).eq("id", user.id);
    if (error) {
      // Rollback: the overlay goes away and the profile's value shows again.
      setSaving(null);
      return;
    }
    await refreshProfile();
    setSaving(null);
  };

  return (
    <Card>
      <View style={styles.header}>
        <BookOpen size={16} color={c.muted} />
        <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>Mushaf</Text>
      </View>
      <View style={styles.options}>
        {MUSHAF_OPTIONS.map((o) => {
          const active = value === o.id;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !!saving }}
              onPress={() => void choose(o.id)}
              style={({ pressed }) => [
                styles.option,
                active
                  ? { borderColor: c.accent, backgroundColor: c.accentTint }
                  : { borderColor: c.border, backgroundColor: c.surface2 },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.grow}>
                <Text style={[Type.subhead, styles.medium, { color: c.foreground }]}>{o.label}</Text>
                <Text style={[Type.caption, { color: c.faint }]}>{o.sub}</Text>
              </View>
              {active && <Check size={20} color={c.accent} />}
            </Pressable>
          );
        })}
      </View>
      <Text style={[Type.caption, styles.helper, { color: c.faint }]}>
        Sets how your reading page maps to juz & surah. Pages count the same either way.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  options: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 12,
  },
  pressed: { opacity: 0.85 },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
  medium: { fontWeight: "500" },
  helper: { marginTop: 8, paddingHorizontal: 4 },
});
