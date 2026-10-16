import { PartyPopper } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, Switch } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { PREF_KEYS, readPref, writePref } from "@/storage/prefs";

/**
 * Settings switch for the log-a-reading celebration. Stored device-local so
 * it needs no migration (web: localStorage; native: AsyncStorage under the
 * same key). Today reads the same key when it gains focus and decides
 * whether to fire confetti. "0" means off; anything else or nothing means on.
 * Ported from reference/web-pwa/components/CelebrateToggle.tsx.
 */
export function CelebrateToggle() {
  const c = useTheme();
  const [on, setOn] = useState(true);
  // The web read localStorage synchronously; AsyncStorage resolves later, so
  // a tap that lands before the read must not be overwritten by the stored
  // value (storage already holds the user's choice).
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readPref(PREF_KEYS.celebrate).then((saved) => {
      if (!cancelled && !touched.current) setOn(saved !== "0");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (next: boolean) => {
    touched.current = true;
    setOn(next);
    void writePref(PREF_KEYS.celebrate, next ? "1" : "0");
  };

  return (
    <Card style={styles.row}>
      <View style={[styles.iconBox, { backgroundColor: c.accentTint }]}>
        <PartyPopper size={20} color={c.accent} />
      </View>
      <View style={styles.grow}>
        <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
          Celebrate readings
        </Text>
        <Text style={[Type.footnote, { color: c.muted }]}>
          {on ? "Confetti + a kind word when you log a reading." : "Off: log quietly."}
        </Text>
      </View>
      <Switch value={on} onValueChange={toggle} accessibilityLabel="Celebrate readings" />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1, minWidth: 0 },
  semibold: { fontWeight: "600" },
});
