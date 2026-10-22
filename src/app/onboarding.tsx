import { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModeStep } from "@/components/onboarding/ModeStep";
import { ProfileStep, type ProfileDraft } from "@/components/onboarding/ProfileStep";
import { detectTimezone } from "@/components/TimezonePicker";
import { Button } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { isOnboarded } from "@/lib/auth";
import type { Mode } from "@/lib/entries";
import { DEFAULT_MUSHAF } from "@/lib/mushaf";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

/**
 * Ported from reference/web-pwa/app/onboarding/OnboardingFlow.tsx + page.tsx.
 * Two steps instead of the web's three: "Add to Home Screen" is meaningless
 * in a real app (docs/HANDOFF.md Phase 1). The root gate shows this screen
 * only while the profile lacks a name or a mode, and flips to the tabs by
 * itself once refreshProfile() returns an onboarded row; nothing here
 * navigates.
 */
export default function OnboardingScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile, signOut } = useSession();
  const userId = user?.id ?? "";
  const email = user?.email ?? "";

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode | null>(profile?.mode ?? null);
  const [draft, setDraft] = useState<ProfileDraft>(() => ({
    name: profile?.display_name ?? email.split("@")[0] ?? "",
    // The web stored the browser's zone silently; native detects the same
    // way and lets the picker override it, because members travel.
    timezone: profile?.timezone || detectTimezone(),
    mushaf: profile?.mushaf ?? DEFAULT_MUSHAF,
    reminderOn: true,
    reminderTime: "06:00",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reminderCreated = useRef(false);

  const patch = (p: Partial<ProfileDraft>) => setDraft((d) => ({ ...d, ...p }));

  const saveProfile = async () => {
    setError(null);
    if (!mode) return;
    if (!draft.name.trim()) {
      setError("Please enter a display name.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      display_name: draft.name.trim(),
      mode,
      timezone: draft.timezone,
      mushaf: draft.mushaf,
      // Deprecated column: recurring reminders live in the `reminders`
      // table (docs/DECISIONS.md § Reminders), so it is always cleared.
      reminder_time: null,
    });
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    // Create the first daily reminder (managed later in Settings). As on the
    // web, a failure here does not block onboarding: the profile is saved.
    if (draft.reminderOn && !reminderCreated.current) {
      const { error: remError } = await supabase.from("reminders").insert({
        user_id: userId,
        time: draft.reminderTime,
        days: [0, 1, 2, 3, 4, 5, 6],
        enabled: true,
      });
      // A success must not be repeated if the profile re-read below fails and
      // the user taps Continue again: that retry path is native-only (the web
      // moved on to its next step with no way back) and would otherwise
      // insert a duplicate 06:00 reminder, so two pushes every morning.
      if (!remError) reminderCreated.current = true;
    }
    // The gate unmounts this screen once the refreshed profile is onboarded,
    // so `saving` stays on. Only an unexpected miss hands control back.
    const next = await refreshProfile();
    if (!isOnboarded(next)) {
      setSaving(false);
      setError("Saved, but your profile did not reload. Please try again.");
    }
  };

  return (
    // keyboard-controller's scroll view on both platforms: RN's
    // KeyboardAvoidingView only moved on iOS (the Android window never
    // resizes under KeyboardProvider), so the name field's keyboard left
    // Continue unreachable there.
    <KeyboardAwareScrollView
      style={[styles.root, { backgroundColor: c.canvas }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      {/* progress */}
      <Text style={[Type.footnote, styles.caption, { color: c.faint }]}>
        Step {step + 1} of 2
      </Text>

      {step === 0 && (
        <>
          <ModeStep mode={mode} onChange={setMode} />
          <View style={styles.actions}>
            <Button fullWidth disabled={!mode} onPress={() => setStep(1)}>
              Continue
            </Button>
          </View>
        </>
      )}

      {step === 1 && (
        <>
          <ProfileStep draft={draft} onChange={patch} />
          {error && (
            <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>
          )}
          <View style={[styles.actions, styles.actionRow]}>
            <Button variant="secondary" disabled={saving} onPress={() => setStep(0)}>
              Back
            </Button>
            <Button fullWidth loading={saving} onPress={saveProfile} style={styles.grow}>
              Continue
            </Button>
          </View>
        </>
      )}

      {/* Escape hatch for a wrong account (kept from the Phase 0 stub). */}
      <Button
        variant="ghost"
        size="md"
        disabled={saving}
        onPress={() => void signOut()}
        style={styles.signOut}
      >
        Sign out
      </Button>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // web: mx-auto max-w-md px-6 pt-14, min-h-dvh so the buttons sit at the bottom
  content: { flexGrow: 1, paddingHorizontal: 24 },
  caption: { fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.65 },
  error: { marginTop: 16 },
  // web: mt-auto pt-8 (the web's mb-10 is the content's bottom padding)
  actions: { marginTop: "auto", paddingTop: 32 },
  actionRow: { flexDirection: "row", gap: 12 },
  grow: { flex: 1 },
  signOut: { alignSelf: "center", marginTop: 8 },
});
