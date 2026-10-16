import { router, useLocalSearchParams } from "expo-router";
import { CalendarCheck, NotebookPen, Settings as SettingsIcon } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { isUuid } from "@/lib/deepLinks";
import { ENTRY_META, TYPES_BY_MODE, type EntryType } from "@/lib/entries";
import { useSession } from "@/providers/SessionProvider";

/**
 * Phase 1 ports reference/web-pwa/app/(app)/today/TodayClient.tsx here.
 * Phase 0 wires the deep link contract from docs/PUSH.md: a reminder push
 * opens /today?log=<type>&r=<reminder id>. Untrusted: only a type this mode
 * offers counts, and the id is only ever an opaque "opened once" key.
 */
export default function TodayScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const { log, r } = useLocalSearchParams<{ log?: string; r?: string }>();

  const mode = profile?.mode ?? "reading";
  const openLog: EntryType | null =
    log && (TYPES_BY_MODE[mode] as string[]).includes(log) ? (log as EntryType) : null;
  const openLogKey = openLog && isUuid(r) ? r : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Placeholder
        icon={CalendarCheck}
        title="Today"
        note={
          openLog
            ? `Opening the ${ENTRY_META[openLog].label} log sheet${openLogKey ? " from your reminder" : ""}. The Today screen lands in the next build.`
            : "The Today screen lands in the next build."
        }
        headerRight={
          <View style={styles.headerButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Journal"
              onPress={() => router.push("/journal")}
              hitSlop={8}
              style={[styles.gear, { backgroundColor: c.surface2 }]}
            >
              <NotebookPen size={20} color={c.muted} />
            </Pressable>
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
        }
      >
        {profile?.display_name ? (
          <Text style={[Type.footnote, { color: c.faint }]}>
            Signed in as {profile.display_name}
          </Text>
        ) : null}
      </Placeholder>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerButtons: { flexDirection: "row", gap: 8 },
  gear: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
