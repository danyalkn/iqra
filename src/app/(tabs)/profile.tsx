import { router, useFocusEffect } from "expo-router";
import { NotebookPen, Settings as SettingsIcon } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NavRow } from "@/components/profile/NavRow";
import { StatCard } from "@/components/profile/StatCard";
import { WhereYouAre } from "@/components/profile/WhereYouAre";
import { Avatar, Card } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useMembership } from "@/hooks/use-membership";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { getMyEntriesAllTime } from "@/lib/data";
import { currentStreak, localDate, longestStreak, monthKey } from "@/lib/dates";
import { ENTRY_META, TYPES_BY_MODE } from "@/lib/entries";
import { DEFAULT_MUSHAF, MUSHAF_OPTIONS } from "@/lib/mushaf";
import { hifzProgress, readingProgress } from "@/lib/progress";
import type { LogRow } from "@/lib/types";
import { useSession } from "@/providers/SessionProvider";
import { supabase } from "@/supabase/client";

const LOAD_ERROR = "Couldn’t load your entries. Pull down to try again.";

/**
 * Fifth tab (owner decision 2026-10-16: Profile replaces Journal in the tab
 * bar). New on native, no web page to port: the identity row comes from
 * reference/web-pwa/components/ProfileSection.tsx and the stat tiles from
 * the Today page. Personal data only, per DECISIONS "No showing off": no
 * comparisons with other members and no leaderboard here.
 *
 * Insets: on iOS react-native-screens flips the tab screen's first scroll
 * view to automatic content-inset adjustment, which already pads the status
 * bar at the top and the (translucent, minimising) tab bar plus home
 * indicator at the bottom, so adding insets.top here would double the top
 * gap. On Android native tabs wrap the screen in a SafeAreaView that only
 * applies the bottom inset and already clears the tab bar and navigation
 * bar, so the top is ours to pad and the bottom gets a fixed 40 only (same
 * reasoning as LIST_BOTTOM_CLEARANCE on Today).
 */
export default function ProfileScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, user } = useSession();
  const { membership } = useMembership();

  const tz = profile?.timezone ?? "UTC";
  const mode = profile?.mode ?? "reading";
  const mushaf = profile?.mushaf ?? DEFAULT_MUSHAF;
  const displayName = profile?.display_name ?? "You";
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

  const mushafLabel = MUSHAF_OPTIONS.find((o) => o.id === mushaf)?.label ?? mushaf;
  const typesLine = TYPES_BY_MODE[mode].map((t) => ENTRY_META[t].label).join(" · ");

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: c.canvas }]}
      contentContainerStyle={{
        paddingTop: Platform.OS === "ios" ? 0 : insets.top,
        paddingBottom: 40,
      }}
      refreshControl={
        membership ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.muted} />
        ) : undefined
      }
    >
      <View style={styles.header}>
        <Text style={[Type.display, { color: c.foreground }]}>Profile</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push("/settings")}
          hitSlop={8}
          style={[styles.gear, { backgroundColor: c.surface2 }]}
        >
          <SettingsIcon size={20} color={c.muted} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Identity: who is signed in, how they study, which mushaf. */}
        <Card>
          <View style={styles.identity}>
            <Avatar name={displayName} src={profile?.avatar_url} size={72} />
            <View style={styles.identityText}>
              <Text style={[Type.title2, { color: c.foreground }]} numberOfLines={1}>
                {displayName}
              </Text>
              {user?.email ? (
                <Text style={[Type.footnote, { color: c.muted }]} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.pills}>
            <View style={[styles.pill, { backgroundColor: c.surface2 }]}>
              <Text style={[Type.caption, { color: c.muted }]}>
                {mode === "hifz" ? "Memorizing (Hifz)" : "Reading"}
              </Text>
            </View>
            <View style={[styles.pill, { backgroundColor: c.surface2 }]}>
              <Text style={[Type.caption, { color: c.muted }]}>{mushafLabel}</Text>
            </View>
          </View>
          <Text style={[Type.footnote, styles.types, { color: c.faint }]}>{typesLine}</Text>
        </Card>

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
          <NavRow
            icon={SettingsIcon}
            iconColor={c.muted}
            iconBackground={c.surface2}
            title="Settings"
            note="Profile, mushaf, reminders, appearance"
            onPress={() => router.push("/settings")}
          />
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 12,
  },
  gear: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 20, gap: 12 },
  identity: { flexDirection: "row", alignItems: "center", gap: 16 },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  types: { marginTop: 8 },
  note: { paddingHorizontal: 4 },
  statRow: { flexDirection: "row", gap: 12 },
  rows: { padding: 0, overflow: "hidden" },
});
