import Constants from "expo-constants";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { LogOut, NotebookPen } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NavRow } from "@/components/profile/NavRow";
import { StatCard } from "@/components/profile/StatCard";
import { WhereYouAre } from "@/components/profile/WhereYouAre";
import { CelebrateToggle } from "@/components/settings/CelebrateToggle";
import { DeleteAccount } from "@/components/settings/DeleteAccount";
import { MushafSelect } from "@/components/settings/MushafSelect";
import { NotificationsToggle } from "@/components/settings/NotificationsToggle";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { RemindersManager } from "@/components/settings/RemindersManager";
import { Button, Card, SegmentedControl } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useMembership } from "@/hooks/use-membership";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { getMyEntriesAllTime } from "@/lib/data";
import { currentStreak, localDate, longestStreak, monthKey } from "@/lib/dates";
import { DEFAULT_MUSHAF } from "@/lib/mushaf";
import { hifzProgress, readingProgress } from "@/lib/progress";
import type { LogRow } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { useThemeContext, type ThemePreference } from "@/providers/ThemeProvider";
import { supabase } from "@/supabase/client";

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

const LOAD_ERROR = "Couldn’t load your entries. Pull down to try again.";

/**
 * Fifth tab (owner decision 2026-10-16: Profile replaces Journal in the tab
 * bar). New on native, no web page to port: the identity card comes from
 * reference/web-pwa/components/ProfileSection.tsx and the stat tiles from
 * the Today page. Personal data only, per DECISIONS "No showing off": no
 * comparisons with other members and no leaderboard here.
 *
 * Owner decision 2026-10-17: the separate Settings screen is gone and every
 * setting lives below the profile content under a "Settings" heading, in the
 * web settings page's order (mushaf, appearance, notifications, celebration,
 * daily reminders, then sign out / delete account and the build line). The
 * identity card is the ProfileSection row, so tapping it edits name, mode and
 * time zone; there is no second profile row in the settings block.
 * /profile?section=settings|notifications|reminders scrolls to that block
 * (Today's gear, the "Turn them on in Settings" link in DayReminders).
 *
 * Insets: the tab screen gets no automatic top inset on either platform (on
 * iOS 26 react-native-screens does not inset the scroll view for the status
 * bar and Dynamic Island), so the root View pads insets.top itself and the
 * ScrollView sits inside it, which also keeps the pull-to-refresh spinner
 * below the status bar. At the bottom the iOS liquid-glass tab bar floats
 * over the screen with nothing insetting the scroll view for it, so
 * insets.bottom (tab bar plus home indicator) is added to the fixed 40. On
 * Android native tabs wrap the screen in a SafeAreaView whose bottom edge
 * already clears the tab bar and navigation bar, so the bottom stays a
 * fixed 40 there (same reasoning as Today and Feed).
 */
export default function ProfileScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, user, signOut } = useSession();
  const { membership } = useMembership();
  const { preference, setPreference } = useThemeContext();
  const [signingOut, setSigningOut] = useState(false);

  const tz = profile?.timezone ?? "UTC";
  const mode = profile?.mode ?? "reading";
  const mushaf = profile?.mushaf ?? DEFAULT_MUSHAF;
  const groupId = membership?.group_id ?? null;
  const userId = user?.id ?? null;

  const [entries, setEntries] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Runs on first focus (mount) and again every time the tab is revisited,
  // so an entry logged on Today shows up here without a manual refresh. The
  // cleanup runs on blur and drops a response that lands after we left.
  useFocusEffect(
    useCallback(() => {
      if (!groupId || !userId) return;
      let cancelled = false;
      getMyEntriesAllTime(supabase, groupId, userId).then(
        (rows) => {
          if (cancelled) return;
          setEntries(rows);
          setError(null);
        },
        () => {
          if (!cancelled) setError(LOAD_ERROR);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [groupId, userId]),
  );

  const onRefresh = useCallback(async () => {
    if (!groupId || !userId) return;
    setRefreshing(true);
    try {
      setEntries(await getMyEntriesAllTime(supabase, groupId, userId));
      setError(null);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setRefreshing(false);
    }
  }, [groupId, userId]);

  // Entries belong to a circle; if membership goes away so do the numbers.
  const rows = membership ? entries : null;

  // A ticking clock (minute-aligned, plus foreground return and focus) so the
  // day-derived numbers roll over while this tab stays mounted; the React
  // Compiler would otherwise memoize a bare todayLocal(tz) on tz alone.
  const now = useNow();
  const today = localDate(now, tz);

  // All-time streaks. Today's Streak tile is bounded by the 120-day
  // getMyRecentEntries window shared with the web, so its "longest" can read
  // lower than this one; the sub-line says "best ever" to make that clear.
  const stats = useMemo(() => {
    if (!rows) return null;
    const loggedDays = new Set(rows.map((e) => localDate(e.logged_at, tz)));
    // "This month" is the real calendar month (1st to today), not a rolling
    // 30 days: distinct logged days whose key matches the current month.
    const month = monthKey(today);
    let monthDays = 0;
    for (const day of loggedDays) if (day.startsWith(month)) monthDays++;
    return {
      streak: currentStreak(loggedDays, tz, now),
      longest: longestStreak(loggedDays),
      monthDays,
      dayOfMonth: +today.slice(8, 10),
    };
  }, [rows, tz, today, now]);

  const progress = useMemo(() => {
    if (!rows) return null;
    const reading = readingProgress(rows, tz);
    const hifz = hifzProgress(rows, tz, mushaf);
    // hifzProgress returns the very row object it was handed (filter and
    // sort do not copy), so an identity lookup recovers the full LogRow for
    // describeEntry without a cast.
    const lastSabak = hifz ? (rows.find((r) => r === hifz.latest) ?? null) : null;
    return { reading, hifz, lastSabak };
  }, [rows, tz, mushaf]);

  // ── Scroll to a settings section ──────────────────────────────────────────
  // Positions come from onLayout: the settings block's y inside the scroll
  // content, plus each linked section's y inside the block. The block always
  // renders, so there is no stale-position case. Unlike Stats, the ScrollView
  // here sits below the root View's top padding (see Insets above), so
  // content offset 0 is already clear of the status bar and no top inset is
  // subtracted from the target. The scroll waits for the entries load to settle, because the
  // stat tiles and WhereYouAre appear above the block and would push it down
  // after the scroll. The link is consumed once, so a re-focus never scrolls.
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
  const settled = membership === null || rows !== null || error !== null;
  const targetY =
    wantSection && blockY != null && settled
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
        refreshControl={
          membership ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} />
          ) : undefined
        }
      >
        <View style={styles.header}>
          <Text style={[Type.display, { color: c.foreground }]}>Profile</Text>
        </View>

        <View style={styles.body}>
          {/* Identity: who is signed in, how they study, which mushaf. Tapping
              it opens the edit sheet (name, mode, time zone). */}
          <ProfileSection />

          {membership === null ? (
            <Text style={[Type.footnote, styles.note, { color: c.muted }]}>
              Ask the group owner to add you to a circle. Your streak and progress show up here
              once you start logging.
            </Text>
          ) : null}

          {error ? (
            <Text style={[Type.footnote, styles.note, { color: c.danger }]}>{error}</Text>
          ) : null}

          {stats ? (
            <View style={styles.statRow}>
              <StatCard
                label="Streak"
                value={stats.streak}
                sub={`${stats.streak === 1 ? "day" : "days"} · best ever ${stats.longest}`}
              />
              <StatCard
                label="This month"
                value={stats.monthDays}
                sub={`of ${stats.dayOfMonth} ${stats.dayOfMonth === 1 ? "day" : "days"} so far`}
              />
            </View>
          ) : null}

          {progress ? (
            <WhereYouAre
              mode={mode}
              reading={progress.reading}
              hifz={progress.hifz}
              lastSabak={progress.lastSabak}
            />
          ) : null}

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
  note: { paddingHorizontal: 4 },
  statRow: { flexDirection: "row", gap: 12 },
  rows: { padding: 0, overflow: "hidden" },
  settings: { paddingHorizontal: 20, marginTop: 32 },
  sections: { gap: 24, paddingTop: 12 },
  cardTitle: { fontWeight: "600", marginBottom: 12 },
  actions: { paddingTop: 8, gap: 4 },
  signOutLabel: { fontWeight: "600" },
  build: { textAlign: "center", paddingTop: 8 },
});
