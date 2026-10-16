import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldLabel } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/SessionProvider";
import { useThemeContext, type ThemePreference } from "@/providers/ThemeProvider";

/**
 * Stack screen over the tabs (web: app/(app)/settings/page.tsx). Phase 1
 * ports the sections (profile, mushaf, notifications, celebration,
 * reminders, delete account). Phase 0 ships the frame, the theme toggle,
 * and sign out so the dev build can be exercised end to end.
 */
export default function SettingsScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, profile, signOut } = useSession();
  const { preference, setPreference } = useThemeContext();

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: 40 }]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/today"))}
          style={[styles.back, { backgroundColor: c.surface2 }]}
        >
          <ArrowLeft size={20} color={c.muted} />
        </Pressable>
        <Text style={[Type.title1, { color: c.foreground }]}>Settings</Text>
      </View>

      <View style={styles.sections}>
        <Card>
          <FieldLabel>Account</FieldLabel>
          <Text style={[Type.callout, { color: c.foreground }]}>
            {profile?.display_name ?? "You"}
          </Text>
          <Text style={[Type.footnote, { color: c.muted }]}>{user?.email ?? ""}</Text>
        </Card>

        <Card>
          <FieldLabel>Appearance</FieldLabel>
          <SegmentedControl<ThemePreference>
            segments={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            value={preference}
            onChange={setPreference}
          />
        </Card>

        <View style={styles.actions}>
          <Button variant="secondary" fullWidth onPress={() => void signOut()}>
            Sign out
          </Button>
        </View>

        <Text style={[Type.caption, styles.build, { color: c.faint }]}>Iqra native, Phase 0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  sections: { gap: 16, paddingTop: 8 },
  actions: { paddingTop: 8 },
  build: { textAlign: "center", paddingTop: 8 },
});
