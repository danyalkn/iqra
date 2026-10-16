import { Bell, BellRing } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Card, FieldLabel, Switch } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/SessionProvider";
import { getPushState, registerPush, unregisterPush, type PushState } from "@/push/register";

/**
 * Settings switch for push notifications. Ported from
 * reference/web-pwa/components/NotificationsToggle.tsx with the web's states
 * (unsupported / denied / off / on plus loading, busy, error) and copy; the
 * web's "needs-install" state (iOS Safari outside the Home Screen) has no
 * native equivalent, and its "Send a test" section does not come back
 * (docs/PHASE3.md). "unsupported" here means a simulator: remote pushes need
 * a real phone.
 *
 * The permission can change under us in the OS Settings app, so the state is
 * re-read whenever the app returns to the foreground (the "denied" note sends
 * people there and back).
 */
export function NotificationsToggle() {
  const c = useTheme();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const check = useCallback(() => {
    if (!userId || busyRef.current) return;
    getPushState(userId)
      .then((s) => {
        if (!busyRef.current) setState(s);
      })
      .catch(() => setState("off"));
  }, [userId]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  const on = state === "on";

  const toggle = async (next: boolean) => {
    if (!userId) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      setState(next ? await registerPush(userId) : await unregisterPush(userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const note: Record<PushState | "loading", string> = {
    loading: "Checking…",
    unsupported: "Push notifications need a real phone; they don’t work on a simulator.",
    denied: "Notifications are blocked for Iqra. Allow them in your phone’s Settings, then come back.",
    off: "Reminders, @mentions, a sunset check-in on unlogged days, and your Sunday recap.",
    on: "You’ll get reminders, @mentions, sunset check-ins, and your Sunday week-in-review.",
  };

  return (
    <View>
      <FieldLabel>Notifications</FieldLabel>
      <Card>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: on ? c.accentTint : c.surface2 }]}>
            {on ? <BellRing size={20} color={c.accent} /> : <Bell size={20} color={c.muted} />}
          </View>
          <View style={styles.grow}>
            <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
              Push notifications
            </Text>
            <Text style={[Type.footnote, { color: c.muted }]}>{note[state]}</Text>
          </View>
          {busy ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            (state === "on" || state === "off") && (
              <Switch value={on} onValueChange={toggle} accessibilityLabel="Push notifications" />
            )
          )}
        </View>
        {state === "denied" && (
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openSettings().catch(() => {})}
            style={({ pressed }) => [styles.settingsLink, pressed && styles.pressed]}
          >
            <Text style={[Type.footnote, styles.semibold, { color: c.accent }]}>Open Settings</Text>
          </Pressable>
        )}
        {error && <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>}
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
  settingsLink: { marginTop: 12, alignSelf: "flex-start" },
  pressed: { opacity: 0.7 },
  error: { marginTop: 12 },
});
