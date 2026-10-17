import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
import { LogOut, NotebookPen } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NavRow } from "@/components/profile/NavRow";
import { CelebrateToggle } from "@/components/settings/CelebrateToggle";
import { DeleteAccount } from "@/components/settings/DeleteAccount";
import { MushafSelect } from "@/components/settings/MushafSelect";
import { NotificationsToggle } from "@/components/settings/NotificationsToggle";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { RemindersManager } from "@/components/settings/RemindersManager";
import { ResetPassword } from "@/components/settings/ResetPassword";
import { Button, Card, SegmentedControl } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/SessionProvider";
import { useThemeContext, type ThemePreference } from "@/providers/ThemeProvider";

/** The web footer showed the git BUILD; native shows the app version from
 *  app.json (Constants.expoConfig is null in some bare contexts, hence "dev"). */
const VERSION = Constants.expoConfig?.version ?? "dev";

/** Gap kept above a section when a /profile?section=... link scrolls to it. */
const SECTION_SCROLL_MARGIN = 16;

type SettingsSection = "settings" | "notifications" | "reminders";

/** A search param as one string. Expo Router can hand back an array for a
 *  repeated key, and a param cleared with setParams may come back as "". */
function oneParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : null;
}

function asSection(v: string | null): SettingsSection | null {
  return v === "settings" || v === "notifications" || v === "reminders" ? v : null;
}

/**
 * Fifth tab (owner decision 2026-10-16: Profile replaces Journal in the tab
 * bar). New on native, no web page to port: the identity card comes from
 * reference/web-pwa/components/ProfileSection.tsx.
 *
 * Owner decisions 2026-10-17: the separate Settings screen is gone, and the
 * streak, "This month" and "Where you are" moved to the Today tab, so this
 * screen is settings first. Order: the identity card (tapping it edits name,
 * mode and time zone), a "Settings" heading with every setting in the web
 * settings page's order (mushaf, appearance, notifications, celebration,
 * daily reminders, reset password), the Journal link, then sign out / delete
 * account and the build line last. Nothing here loads data, so there is no pull-to-refresh.
 * /profile?section=settings|notifications|reminders scrolls to the settings
 * block (Today's gear, the "Turn them on in Settings" link in DayReminders).
 *
 * Insets: the tab screen gets no automatic top inset on either platform (on
 * iOS 26 react-native-screens does not inset the scroll view for the status
 * bar and Dynamic Island), so the root View pads insets.top itself and the
 * ScrollView sits inside it. At the bottom the iOS liquid-glass tab bar floats
 * over the screen with nothing insetting the scroll view for it, so
 * insets.bottom (tab bar plus home indicator) is added to the fixed 40. On
 * Android native tabs wrap the screen in a SafeAreaView whose bottom edge
 * already clears the tab bar and navigation bar, so the bottom stays a
 * fixed 40 there (same reasoning as Today and Feed).
 */
export default function ProfileScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();
  const { preference, setPreference } = useThemeContext();
  const [signingOut, setSigningOut] = useState(false);

  // ── Scroll to a settings section ──────────────────────────────────────────
  // Positions come from onLayout: the settings block's y inside the scroll
  // content, plus each linked section's y inside the block. Nothing async
  // renders above the block (the identity card is session state), so its y is
  // final at first layout and the scroll can fire as soon as it is measured.
  // The ScrollView sits below the root View's top padding (see Insets above),
  // so content offset 0 is already clear of the status bar and no top inset
  // is subtracted from the target. The link is consumed once, so a re-focus
  // never scrolls.
  const params = useLocalSearchParams<{ section?: string }>();
  const wantSection = asSection(oneParam(params.section));
  const [blockY, setBlockY] = useState<number | null>(null);
  const [sectionY, setSectionY] = useState<{ notifications?: number; reminders?: number }>({});
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const onBlockLayout = useCallback((e: LayoutChangeEvent) => {
    setBlockY(e.nativeEvent.layout.y);
  }, []);
  const onNotificationsLayout = useCallback((e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    setSectionY((p) => (p.notifications === y ? p : { ...p, notifications: y }));
  }, []);
  const onRemindersLayout = useCallback((e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    setSectionY((p) => (p.reminders === y ? p : { ...p, reminders: y }));
  }, []);
  const targetY =
    wantSection && blockY != null
      ? wantSection === "settings"
        ? blockY
        : sectionY[wantSection] != null
          ? blockY + (sectionY[wantSection] ?? 0)
          : null
      : null;
  useEffect(() => {
    if (targetY == null) return;
    // After paint, so layout is settled before we scroll.
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, targetY - SECTION_SCROLL_MARGIN),
        animated: true,
      });
      // setParams merges and an undefined value reads back as absent.
      router.setParams({ section: undefined });
    });
    return () => cancelAnimationFrame(id);
  }, [targetY]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.canvas }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingBottom: Platform.OS === "ios" ? 40 + insets.bottom : 40,
        }}
      >
        <View style={styles.header}>
          <Text style={[Type.display, { color: c.foreground }]}>Profile</Text>
        </View>

        <View style={styles.body}>
          {/* Identity: who is signed in, how they study, which mushaf. Tapping
              it opens the edit sheet (name, mode, time zone). */}
          <ProfileSection />
        </View>

        <View style={styles.settings} onLayout={onBlockLayout}>
          <Text accessibilityRole="header" style={[Type.title2, { color: c.foreground }]}>
            Settings
          </Text>

          <View style={styles.sections}>
            <MushafSelect />

            {/* Web: components/ThemeToggle.tsx. The preference lives in
                ThemeProvider (same "iqra:theme" key) instead of the <html>
                dataset, and the status bar follows the resolved scheme. */}
            <Card>
              <Text style={[Type.callout, styles.cardTitle, { color: c.foreground }]}>
                Appearance
              </Text>
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

            <View onLayout={onNotificationsLayout}>
              <NotificationsToggle />
            </View>

            <CelebrateToggle />

            <View onLayout={onRemindersLayout}>{user && <RemindersManager userId={user.id} />}</View>

            <ResetPassword />
          </View>
        </View>

        <View style={styles.body}>
          <Card style={styles.rows}>
            <NavRow
              first
              icon={NotebookPen}
              iconColor={c.accent}
              iconBackground={c.accentTint}
              title="Journal"
              note="Everything you’ve logged, with your notes"
              onPress={() => router.push("/journal")}
            />
          </Card>
        </View>

        <View style={styles.footer}>
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

          <Text style={[Type.caption, styles.build, { color: c.faint }]}>
            Iqra · build {VERSION}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 12,
  },
  body: { paddingHorizontal: 20, gap: 12 },
  rows: { padding: 0, overflow: "hidden" },
  settings: { paddingHorizontal: 20, marginTop: 32, marginBottom: 24 },
  sections: { gap: 24, paddingTop: 12 },
  cardTitle: { fontWeight: "600", marginBottom: 12 },
  footer: { paddingHorizontal: 20, marginTop: 24, gap: 4 },
  signOutLabel: { fontWeight: "600" },
  build: { textAlign: "center", paddingTop: 8 },
});
