import Constants from "expo-constants";
import { router } from "expo-router";
import { ArrowLeft, LogOut } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CelebrateToggle } from "@/components/settings/CelebrateToggle";
import { DeleteAccount } from "@/components/settings/DeleteAccount";
import { MushafSelect } from "@/components/settings/MushafSelect";
import { NotificationsToggle } from "@/components/settings/NotificationsToggle";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { RemindersManager } from "@/components/settings/RemindersManager";
import { Button, Card, SegmentedControl } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/SessionProvider";
import { useThemeContext, type ThemePreference } from "@/providers/ThemeProvider";

/** The web footer showed the git BUILD; native shows the app version from
 *  app.json (Constants.expoConfig is null in some bare contexts, hence "dev"). */
const VERSION = Constants.expoConfig?.version ?? "dev";

/**
 * Stack screen over the tabs (web: app/(app)/settings/page.tsx), same
 * section order as the web: profile, mushaf, appearance, notifications,
 * celebration, daily reminders, then sign out / delete account and the build
 * line. Each section is its own component under src/components/settings.
 * Being a Stack card (not a tab) there is no tab bar under it, so the bottom
 * padding is just the home indicator inset plus the web's pb-10.
 */
export default function SettingsScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();
  const { preference, setPreference } = useThemeContext();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <ScrollView
      style={{ backgroundColor: c.canvas }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
      ]}
      keyboardShouldPersistTaps="handled"
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
        <ProfileSection />

        <MushafSelect />

        {/* Web: components/ThemeToggle.tsx. The preference lives in
            ThemeProvider (same "iqra:theme" key) instead of the <html>
            dataset, and the status bar follows the resolved scheme. */}
        <Card>
          <Text style={[Type.callout, styles.cardTitle, { color: c.foreground }]}>Appearance</Text>
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

        <NotificationsToggle />

        <CelebrateToggle />

        {user && <RemindersManager userId={user.id} />}

        <View style={styles.actions}>
          {/* Web: components/SignOutButton.tsx. The gate flips to login on
              SIGNED_OUT, so no navigation here. */}
          <Button
            variant="secondary"
            fullWidth
            loading={signingOut}
            onPress={() => {
              setSigningOut(true);
              void signOut();
            }}
          >
            <LogOut size={16} color={c.foreground} />
            <Text style={[Type.callout, styles.signOutLabel, { color: c.foreground }]}>
              Sign out
            </Text>
          </Button>
          <DeleteAccount />
        </View>

        <Text style={[Type.caption, styles.build, { color: c.faint }]}>
          Iqra · build {VERSION}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  sections: { gap: 24, paddingTop: 8 },
  cardTitle: { fontWeight: "600", marginBottom: 12 },
  actions: { paddingTop: 8, gap: 4 },
  signOutLabel: { fontWeight: "600" },
  build: { textAlign: "center", paddingTop: 8 },
});
