import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

// The on/off pref is PREF_KEYS.celebrate in "@/storage/prefs"; Today reads it
// and simply never bumps `trigger` when it is off. This component does not.

const MESSAGES = [
  "MashaAllah 📖",
  "May Allah accept it 🤲",
  "Keep going 🌙",
  "Another page closer ✨",
  "BarakAllahu feek 💚",
  "Beautiful work 🎉",
  "One step at a time 🕌",
  "So proud of you 🌟",
];

const COLORS = ["#1b6b53", "#4fb590", "#d9a24a", "#e06a5c", "#5fc8a1", "#f0c674"];

/** Everything unmounts after this (web: 2400ms). */
const SHOW_MS = 2400;
const POP_MS = 320;

type Piece = {
  left: number; // percent of the window width
  w: number;
  h: number;
  color: string;
  dx: number; // horizontal drift over the fall (points)
  rot: number; // total spin (degrees)
  dur: number; // seconds
  delay: number; // seconds
};

function makePieces(): Piece[] {
  return Array.from({ length: 46 }, () => ({
    left: Math.random() * 100,
    w: 6 + Math.random() * 6,
    h: 10 + Math.random() * 8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    dx: (Math.random() - 0.5) * 220,
    rot: 360 + Math.random() * 540,
    dur: 1.6 + Math.random() * 0.9,
    delay: Math.random() * 0.25,
  }));
}

function pickMessage(): string {
  return MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
}

type Show = { trigger: number; msg: string; pieces: Piece[] };

/** Confetti burst + an encouraging word. Plays once whenever `trigger` changes
 *  to a new value (never for 0). Respects the system reduce-motion setting
 *  (skips the confetti, keeps the card).
 *
 *  Ported from reference/web-pwa/components/Celebration.tsx. The web portalled
 *  this to document.body; here it is an absolute-fill, touch-transparent layer
 *  that Today places last in its root View. */
export function Celebration({ trigger }: { trigger: number }) {
  const reduce = useReducedMotion();
  const [show, setShow] = useState<Show | null>(null);

  // The message and pieces are random, so they are picked off the render
  // path: the effect hands the pick to a zero-delay timer (React's purity
  // and set-state-in-effect rules both hold), then clears everything after
  // SHOW_MS. A new trigger inside the window resets both timers.
  useEffect(() => {
    if (trigger === 0) return;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const start = setTimeout(() => {
      setShow({ trigger, msg: pickMessage(), pieces: makePieces() });
      hide = setTimeout(() => setShow(null), SHOW_MS);
    }, 0);
    return () => {
      clearTimeout(start);
      if (hide) clearTimeout(hide);
    };
  }, [trigger]);

  if (!show) return null;

  return (
    <View style={styles.layer}>
      {/* Reduce motion keeps the card and drops the confetti, like the web's
          prefers-reduced-motion check. */}
      {(reduce ? [] : show.pieces).map((p, i) => (
        // Keyed on the trigger too: a second log inside the 2.4s window swaps
        // the pieces, and a fresh key is what restarts their fall.
        <ConfettiPiece key={`${show.trigger}-${i}`} piece={p} />
      ))}
      <View style={styles.center}>
        <MessageCard key={show.trigger} msg={show.msg} />
      </View>
    </View>
  );
}

/** One rectangle falling from above the top edge to below the bottom, with
 *  horizontal drift and spin (web: confettiFall, linear). The web kept full
 *  opacity to the end and let the piece leave the viewport; here it fades
 *  over the last third so the exit reads softly on a short phone screen. */
function ConfettiPiece({ piece: p }: { piece: Piece }) {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(
      withDelay(p.delay * 1000, withTiming(1, { duration: p.dur * 1000, easing: Easing.linear })),
    );
  }, [p.delay, p.dur, progress]);
  const fall = useAnimatedStyle(() => {
    const t = progress.get();
    return {
      opacity: interpolate(t, [0, 0.66, 1], [1, 1, 0]),
      transform: [
        { translateY: interpolate(t, [0, 1], [-(p.h + 8), height + 40]) },
        { translateX: interpolate(t, [0, 1], [0, p.dx]) },
        { rotate: `${interpolate(t, [0, 1], [0, p.rot])}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.piece,
        {
          left: (p.left / 100) * width,
          width: p.w,
          height: p.h,
          backgroundColor: p.color,
        },
        fall,
      ]}
    />
  );
}

/** The encouragement card (web: popIn 320ms spring-ish, rounded-2xl
 *  bg-surface px-6 py-4 shadow-e3). */
function MessageCard({ msg }: { msg: string }) {
  const c = useTheme();
  const reduce = useReducedMotion();
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      scale.set(1);
      opacity.set(1);
      return;
    }
    scale.set(withSpring(1, { damping: 14, stiffness: 180, mass: 0.8 }));
    opacity.set(withTiming(1, { duration: POP_MS * 0.6, easing: Easing.out(Easing.quad) }));
  }, [opacity, reduce, scale]);
  const pop = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ scale: scale.get() }],
  }));
  return (
    <Animated.View style={[styles.card, Elevation.e3, { backgroundColor: c.surface }, pop]}>
      <Text style={[Type.title3, styles.msg, { color: c.foreground }]}>{msg}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: 100,
    ...(Platform.OS === "android" ? { elevation: 100 } : null),
  },
  piece: { position: "absolute", top: 0, borderRadius: 1 },
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: Radius.lg,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  msg: { fontWeight: "600", textAlign: "center" },
});
