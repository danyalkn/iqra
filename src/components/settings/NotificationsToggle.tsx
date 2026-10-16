import { Bell } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { Card, FieldLabel, Switch } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * STUB until Phase 3 (docs/PUSH.md, docs/HANDOFF.md Phase 3).
 *
 * The web version (reference/web-pwa/components/NotificationsToggle.tsx)
 * drove Web Push: permission state, the service-worker subscription, a
 * push_subscriptions upsert and a "send a test" link. None of that exists on
 * native yet, so this renders the same card in its "off" look with the
 * switch disabled. Phase 3 replaces it with the expo-notifications
 * permission flow and the push_subscriptions upsert (Expo push token); the
 * "send a test" section is not coming back.
 */
export function NotificationsToggle() {
  const c = useTheme();
  return (
    <View>
      <FieldLabel>Notifications</FieldLabel>
      <Card>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: c.surface2 }]}>
            <Bell size={20} color={c.muted} />
          </View>
          <View style={styles.grow}>
            <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
              Push notifications
            </Text>
            <Text style={[Type.footnote, { color: c.muted }]}>
              Reminders, @mentions, a sunset check-in on unlogged days, and your Sunday recap.
              Arrives in a later build.
            </Text>
          </View>
          <Switch value={false} disabled accessibilityLabel="Push notifications" />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
});
