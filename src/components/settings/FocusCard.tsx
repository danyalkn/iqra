import { Shield, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Button, Card, FieldLabel, Switch } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import {
  changeSelection,
  disableFocus,
  enableFocus,
  pauseFocus,
  reconcileFocus,
  resumeFocus,
} from "@/focus/controls";
import {
  authStatus,
  focusAvailable,
  requestFocusAuth,
  savedSelection,
  selectionCounts,
  SelectionSheet,
  type FocusAuth,
} from "@/focus/focus";
import { readFocusState, subscribeFocus } from "@/focus/state";
import { useFocusContext } from "@/focus/useFocusContext";
import { useNow } from "@/hooks/use-now";
import { useTheme } from "@/hooks/use-theme";
import { localDate } from "@/lib/dates";
import {
  FOCUS_OFF,
  focusStatus,
  selectionSummary,
  type FocusState,
  type SelectionCounts,
} from "@/lib/focus";

/**
 * Settings card for Focus (docs/FOCUS.md § 5): block the apps you choose
 * until today's Quran is logged. Same shape as NotificationsToggle (card,
 * switch, a note, re-check on foreground). Screen Time, Family Controls and
 * the other Apple names never appear in copy.
 *
 * Turning on asks for Screen Time access, then opens Apple's picker as a
 * sheet; a cancelled or empty picker leaves Focus off. "Change apps"
 * reopens it. Pause is always there and never counted (decision 5). The
 * switch turns everything off at once.
 *
 * Android has no counterpart yet (docs/SCREEN-TIME.md § Android), so the
 * card just says so there. iOS without Screen Time (never, on SDK 58's
 * minimum) hides it.
 */

/** How long the picker's debounced final selection may trail its Done. */
const PICKER_SETTLE_MS = 400;

type Picker = { purpose: "enable" | "change"; initial: string | null };

export function FocusCard() {
  const c = useTheme();
  const ctx = useFocusContext();
  const userId = ctx?.userId ?? null;
  const tz = ctx?.tz ?? "UTC";
  const now = useNow();
  const today = localDate(now, tz);

  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<FocusState>(FOCUS_OFF);
  const [auth, setAuth] = useState<FocusAuth>("notDetermined");
  const [counts, setCounts] = useState<SelectionCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const picked = useRef<string | null>(null);
  const busyRef = useRef(false);

  // Everything is read in the callback, after the stored state lands, so
  // the effect below never sets state on its own (react-hooks rule).
  const refresh = useCallback(() => {
    if (!userId || !focusAvailable()) return;
    readFocusState(userId)
      .then((s) => {
        setAuth(authStatus());
        setCounts(selectionCounts());
        if (!busyRef.current) setState(s);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [userId]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    const unsubscribe = subscribeFocus(refresh);
    return () => {
      sub.remove();
      unsubscribe();
    };
  }, [refresh]);

  if (Platform.OS === "android") return <ComingSoon />;
  if (!focusAvailable() || !ctx) return null;

  const setBusyBoth = (b: boolean) => {
    busyRef.current = b;
    setBusy(b);
  };

  // Access first, then the picker. The system sheet can be shown again
  // after a refusal, so the "Allow access" button comes here too; with
  // Focus already on (access revoked in Settings, then granted again) the
  // schedule and the block are simply put back.
  const turnOn = async () => {
    setBusyBoth(true);
    setError(null);
    const status = await requestFocusAuth();
    setAuth(status);
    if (status !== "approved") {
      setBusyBoth(false);
      return;
    }
    if (state.enabled) {
      await reconcileFocus(ctx);
      setBusyBoth(false);
      refresh();
      return;
    }
    setBusyBoth(false);
    picked.current = null;
    setPicker({ purpose: "enable", initial: null });
  };

  const turnOff = async () => {
    setBusyBoth(true);
    setError(null);
    await disableFocus(ctx);
    setBusyBoth(false);
    refresh();
  };

  const changeApps = () => {
    picked.current = null;
    setPicker({ purpose: "change", initial: savedSelection() });
  };

  // Cancel and Done both end here with no say which; the selection the
  // picker last reported decides. Nothing reported means cancelled (or
  // everything deselected), which changes nothing.
  const onPickerClosed = () => {
    const purpose = picker?.purpose;
    setPicker(null);
    setTimeout(async () => {
      const token = picked.current;
      if (!token || !purpose) return;
      setBusyBoth(true);
      setError(null);
      try {
        if (purpose === "enable") await enableFocus(ctx, token);
        else await changeSelection(ctx, token);
      } catch (e) {
        console.warn("Focus enable failed", e);
        setError("Couldn’t turn Focus on. Check that Iqra still has Screen Time access, then try again.");
      }
      setBusyBoth(false);
      refresh();
    }, PICKER_SETTLE_MS);
  };

  const pause = async () => {
    setBusyBoth(true);
    await pauseFocus(ctx);
    setBusyBoth(false);
    refresh();
  };

  const resume = async () => {
    setBusyBoth(true);
    await resumeFocus(ctx);
    setBusyBoth(false);
    refresh();
  };

  const status = focusStatus(state, today);
  const on = state.enabled;
  // Refused when asked, or revoked in iOS Settings while Focus was on (iOS
  // lifts the block itself then; the status is seen after a restart).
  const needsAccess = auth !== "approved" && (on || auth === "denied");
  const summary = counts ? selectionSummary(counts) : "";

  let note: string;
  if (!loaded) note = "Checking…";
  else if (needsAccess) {
    note =
      "Iqra needs Screen Time access to block apps. Allow it when asked, or under Settings > Screen Time, then reopen Iqra.";
  } else if (status === "off") {
    note = "Block the apps you choose until you’ve logged today’s Quran. Only on this phone, only for you.";
  } else if (status === "unlocked") {
    note = `${summary || "Your apps"}. Unlocked for today, blocked again from midnight.`;
  } else if (status === "paused") {
    note = `${summary || "Your apps"}. Paused until tomorrow.`;
  } else {
    note = `${summary || "Your apps"}. Blocked until you log today.`;
  }

  return (
    <View>
      <FieldLabel>Focus</FieldLabel>
      <Card>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: on ? c.accentTint : c.surface2 }]}>
            {on ? <ShieldCheck size={20} color={c.accent} /> : <Shield size={20} color={c.muted} />}
          </View>
          <View style={styles.grow}>
            <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
              Block apps until you’ve logged
            </Text>
            <Text style={[Type.footnote, { color: c.muted }]}>{note}</Text>
          </View>
          {busy ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            loaded &&
            (on || !needsAccess) && (
              <Switch
                value={on}
                onValueChange={(next) => void (next ? turnOn() : turnOff())}
                accessibilityLabel="Block apps until you’ve logged"
              />
            )
          )}
        </View>
        {loaded && needsAccess && !busy && (
          <View style={styles.actions}>
            <Button variant="secondary" size="md" onPress={() => void turnOn()}>
              Allow access
            </Button>
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openSettings().catch(() => {})}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={[Type.footnote, styles.semibold, { color: c.accent }]}>Open Settings</Text>
            </Pressable>
          </View>
        )}
        {on && !needsAccess && !busy && (
          <View style={styles.actions}>
            <Button variant="secondary" size="md" onPress={changeApps}>
              Change apps
            </Button>
            {status === "paused" ? (
              <Button variant="secondary" size="md" onPress={() => void resume()}>
                Resume
              </Button>
            ) : (
              status === "blocked" && (
                <Button variant="secondary" size="md" onPress={() => void pause()}>
                  Pause until tomorrow
                </Button>
              )
            )}
          </View>
        )}
        {error && <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>}
        {picker && SelectionSheet && (
          // An invisible anchor: the native side presents Apple's picker as
          // a sheet from it and reports Cancel/Done through onDismissRequest.
          <SelectionSheet
            style={styles.anchor}
            {...(picker.initial ? { familyActivitySelection: picker.initial } : {})}
            onSelectionChange={(e) => {
              picked.current = e.nativeEvent.familyActivitySelection ?? null;
            }}
            onDismissRequest={onPickerClosed}
          />
        )}
      </Card>
    </View>
  );
}

/** Android: the plan is docs/SCREEN-TIME.md § Android; until then the
 *  card only says it is coming (owner, 2026-10-21). */
function ComingSoon() {
  const c = useTheme();
  return (
    <View>
      <FieldLabel>Focus</FieldLabel>
      <Card>
        <View style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: c.surface2 }]}>
            <Shield size={20} color={c.muted} />
          </View>
          <View style={styles.grow}>
            <Text style={[Type.callout, styles.semibold, { color: c.foreground }]}>
              Block apps until you’ve logged
            </Text>
            <Text style={[Type.footnote, { color: c.muted }]}>
              Block the apps you choose until you’ve logged today’s Quran. Coming soon to Android.
            </Text>
          </View>
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
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 },
  link: { paddingVertical: 8, paddingHorizontal: 4 },
  pressed: { opacity: 0.7 },
  error: { marginTop: 12 },
  anchor: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
