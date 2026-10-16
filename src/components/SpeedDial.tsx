import * as Haptics from "expo-haptics";
import { AlarmClockPlus, Plus, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { ENTRY_ICON } from "@/components/entryIcons";
import { Elevation } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";
import { ENTRY_META, TYPES_BY_MODE, type EntryType, type Mode } from "@/lib/entries";

const FAB_SIZE = 64;
/** Pills column sits this far above the FAB's bottom edge (web: bottom-[6rem]
 *  against a bottom-5 button, so 96 - 20). */
const PILLS_ABOVE_FAB = 76;
const SCRIM_MS = 140;
const DIAL_MS = 170;
const STAGGER_MS = 22;
const ROTATE_MS = 300;

/** Google-Calendar-style expanding FAB. Scrim + pills + button all live in the
 *  Today container (same coordinate space) so the pills sit cleanly above the
 *  button. Tap the + to fan out the entry types for the user's mode.
 *
 *  Ported from reference/web-pwa/components/SpeedDial.tsx. Rendered inside the
 *  Today screen's root View (flex 1) and positions itself absolutely. */
export function SpeedDial({
  mode,
  onPick,
  onReminder,
  disabled,
  defaultOpen = false,
  bottomOffset = 20,
}: {
  mode: Mode;
  onPick: (type: EntryType) => void;
  /** Opens the one-time reminder sheet. Only joins a fan-out that already
   *  exists: a single-type mode keeps its one-tap FAB (readers log every
   *  day) and reaches reminders through the section on Today instead. */
  onReminder?: () => void;
  disabled?: boolean;
  defaultOpen?: boolean;
  /** Distance from the bottom of the Today root to the FAB (web: bottom-5).
   *  Today adds the safe-area + tab-bar allowance here. */
  bottomOffset?: number;
}) {
  const c = useTheme();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const types = TYPES_BY_MODE[mode];
  const single = types.length === 1;
  const reminderPill = !single && Boolean(onReminder);

  // The + turns into an x by rotating 45deg (web: rotate-45, 300ms).
  const rotation = useSharedValue(defaultOpen ? 45 : 0);
  useEffect(() => {
    rotation.set(withTiming(open ? 45 : 0, { duration: reduceMotion ? 0 : ROTATE_MS }));
  }, [open, reduceMotion, rotation]);
  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.get()}deg` }],
  }));

  const choose = (t: EntryType) => {
    setOpen(false);
    onPick(t);
  };

  const remind = () => {
    setOpen(false);
    onReminder?.();
  };

  const onFab = () => {
    if (single) {
      onPick(types[0]); // skip the fan-out for a single option
      return;
    }
    if (!open) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpen((v) => !v);
  };

  return (
    <>
      {open && <Scrim onPress={() => setOpen(false)} />}

      {open && (
        <View style={[styles.pills, { bottom: bottomOffset + PILLS_ABOVE_FAB }]}>
          {/* Reminder sits at the top, apart from the entry types below, in a
              neutral well so it reads as a different kind of action. */}
          {reminderPill && (
            <DialPill
              label="Remind me"
              icon={AlarmClockPlus}
              wellColor={c.surface2}
              iconColor={c.muted}
              delay={0}
              onPress={remind}
              style={styles.reminderPill}
            />
          )}
          {types.map((t, i) => (
            <DialPill
              key={t}
              label={ENTRY_META[t].label}
              icon={ENTRY_ICON[t]}
              wellColor={c.accentTint}
              iconColor={c.accent}
              delay={(i + (reminderPill ? 1 : 0)) * STAGGER_MS}
              onPress={() => choose(t)}
            />
          ))}
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? "Close" : "Add entry"}
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        disabled={disabled}
        onPress={onFab}
        style={({ pressed }) => [
          styles.fab,
          Elevation.e3,
          { backgroundColor: c.accent, bottom: bottomOffset },
          // Web: active:scale-95, motion-reduce:active:scale-100.
          pressed && !disabled && !reduceMotion && styles.fabPressed,
          disabled && styles.fabDisabled,
        ]}
      >
        <Animated.View style={plusStyle}>
          <Plus size={32} color={c.onAccent} strokeWidth={2.5} />
        </Animated.View>
      </Pressable>
    </>
  );
}

/** Dim layer behind the open fan (web: bg-black/30, fadeIn 140ms). A tap
 *  anywhere on it closes the dial. */
function Scrim({ onPress }: { onPress: () => void }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withTiming(1, { duration: reduceMotion ? 0 : SCRIM_MS, easing: Easing.out(Easing.quad) }));
  }, [opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[styles.scrim, style]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.fill} onPress={onPress} />
    </Animated.View>
  );
}

/** One fan-out option: label on the left, round icon well on the right.
 *  Enters with the web's dialIn (fade + rise + grow, spring-ish ease),
 *  staggered by `delay` so the column unfolds top to bottom. */
function DialPill({
  label,
  icon: Icon,
  wellColor,
  iconColor,
  delay,
  onPress,
  style,
}: {
  label: string;
  icon: LucideIcon;
  wellColor: string;
  iconColor: string;
  delay: number;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const dark = useColorScheme() === "dark";
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      progress.set(1);
      return;
    }
    progress.set(
      withDelay(
        delay,
        withTiming(1, { duration: DIAL_MS, easing: Easing.out(Easing.back(1)) }),
      ),
    );
  }, [delay, progress, reduceMotion]);
  const enter = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      // The back easing overshoots past 1; opacity is clamped, scale may
      // peek slightly over 1 for the spring feel.
      opacity: Math.min(1, Math.max(0, p)),
      transform: [
        { translateY: interpolate(p, [0, 1], [12, 0]) },
        { scale: interpolate(p, [0, 1], [0.9, 1]) },
      ],
    };
  });

  return (
    <Animated.View style={[enter, style]}>
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.pill,
          Elevation.e2,
          { backgroundColor: c.surface },
          // Dark mode: the web's shadows vanish on a dark canvas, so the
          // surface gets the same hairline ring Card uses.
          dark && { borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
          pressed && styles.pillPressed,
        ]}
      >
        <Text style={[styles.pillLabel, { color: c.foreground }]}>{label}</Text>
        <View style={[styles.well, { backgroundColor: wellColor }]}>
          <Icon size={20} color={iconColor} strokeWidth={2.25} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
    zIndex: 40,
  },
  pills: {
    position: "absolute",
    right: 16,
    alignItems: "flex-end",
    gap: 14,
    zIndex: 50,
  },
  reminderPill: { marginBottom: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 999,
    paddingVertical: 14,
    paddingLeft: 28,
    paddingRight: 14,
  },
  pillPressed: { opacity: 0.9 },
  pillLabel: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  well: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    right: 16,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  fabPressed: { transform: [{ scale: 0.95 }] },
  fabDisabled: { opacity: 0.4 },
});
