import { Copy, Reply } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Elevation, Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useWindowInsets } from "@/hooks/use-window-insets";

import { QUICK_EMOJI } from "./shared";

/** The long-pressed bubble's frame in window coordinates (measureInWindow). */
export type Anchor = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

const PILL_W = 272;
const MENU_W = 168;
/** Pill top to the top of a menu stacked under it (web: pillTop + 56; the
 *  pill is 52 tall). */
const PILL_STEP = 56;
/** One menu row (12 + 22 + 12) until the real menu reports its height. */
const MENU_ROW_H = 46;
/** Scrim behind the overlay (web: bg-black/25). */
const SCRIM = "rgba(0, 0, 0, 0.25)";

/**
 * Floating long-press overlay: IG-style emoji bar above the message and a
 * Reply / Copy menu below it. Ported from ActionOverlay in
 * reference/web-pwa/app/(app)/chat/ChatClient.tsx. The web portalled it to
 * document.body; native uses a transparent Modal so it sits above the tab
 * bar and the list, with statusBarTranslucent so the Modal's origin matches
 * the window coordinates the anchor was measured in (Android would
 * otherwise be offset by the status bar).
 */
export function ActionOverlay({
  anchor,
  mine,
  myEmoji,
  onReact,
  onReply,
  onCopy,
  onClose,
}: {
  anchor: Anchor;
  mine: boolean;
  myEmoji: string | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  /** Null for a picture without a caption: nothing to copy, no Copy row. */
  onCopy: (() => void) | null;
  onClose: () => void;
}) {
  const c = useTheme();
  const { width: vw, height: windowH } = useWindowDimensions();
  const insets = useWindowInsets();
  const reduceMotion = useReducedMotion();
  // The overlay's real height and the menu's (font size changes both),
  // null until laid out. Until both are known the pill and menu stay
  // invisible, so a first frame placed from the estimates never shows and
  // then jumps (larger text, Reduce Motion with no fade to hide it).
  const [frameH, setFrameH] = useState<number | null>(null);
  const [menuH, setMenuH] = useState<number | null>(null);
  const measured = frameH != null && menuH != null;

  // Anchored to the bubble's edge on the sender's side, clamped 8 from the
  // screen edges (web). Vertically the web put the pill 60 above the bubble
  // and the menu 10 under it, or both under the bubble near the top. It had
  // no pictures: a tall picture near the composer pushed the menu off the
  // bottom, so when the menu has no room below, pill and menu stack above
  // the bubble, and a bubble taller than the screen gets both pinned to
  // the safe edges over it.
  const clampX = (x: number, w: number) => Math.min(Math.max(x, 8), vw - w - 8);
  const pillLeft = clampX(mine ? anchor.right - PILL_W : anchor.left, PILL_W);
  const menuLeft = clampX(mine ? anchor.right - MENU_W : anchor.left, MENU_W);
  const { pillTop, menuTop } = placeVertically(
    anchor,
    menuH ?? (onCopy ? MENU_ROW_H * 2 + 1 : MENU_ROW_H),
    insets.top + 8,
    (frameH ?? windowH) - insets.bottom - 8,
  );

  // Web: animate-[dialIn_170ms] on the pill and 190ms on the menu (scale +
  // fade with the spring ease), started once both are placed for real.
  // Reduce motion skips straight to the end.
  const pillIn = useSharedValue(0);
  const menuIn = useSharedValue(0);
  useEffect(() => {
    if (!measured) return;
    if (reduceMotion) {
      pillIn.set(1);
      menuIn.set(1);
      return;
    }
    const easing = Easing.out(Easing.back(1.6));
    pillIn.set(withTiming(1, { duration: 170, easing }));
    menuIn.set(withTiming(1, { duration: 190, easing }));
    // pillIn/menuIn are stable shared-value refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, reduceMotion]);
  const pillStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, pillIn.get()),
    transform: [{ scale: 0.9 + 0.1 * pillIn.get() }],
  }));
  const menuStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, menuIn.get()),
    transform: [{ scale: 0.9 + 0.1 * menuIn.get() }],
  }));

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.scrim}
        onPress={onClose}
        onLayout={(e) => setFrameH(e.nativeEvent.layout.height)}
      />

      {/* Quick reactions */}
      <Animated.View
        style={[
          styles.pill,
          Elevation.e3,
          { top: pillTop, left: pillLeft, backgroundColor: c.surface },
          pillStyle,
        ]}
      >
        {QUICK_EMOJI.map((e) => (
          <Pressable
            key={e}
            accessibilityRole="button"
            accessibilityLabel={`React ${e}`}
            onPress={() => onReact(e)}
            style={({ pressed }) => [
              styles.emojiButton,
              myEmoji === e && { backgroundColor: c.accentTint },
              pressed && styles.emojiPressed,
            ]}
          >
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        ))}
      </Animated.View>

      {/* Actions */}
      <Animated.View
        onLayout={(e) => setMenuH(e.nativeEvent.layout.height)}
        style={[
          styles.menu,
          Elevation.e3,
          { top: menuTop, left: menuLeft, backgroundColor: c.surface },
          menuStyle,
        ]}
      >
        <View style={styles.menuClip}>
          <Pressable
            accessibilityRole="button"
            onPress={onReply}
            style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: c.surface2 }]}
          >
            <Text style={[Type.callout, styles.menuLabel, { color: c.foreground }]}>Reply</Text>
            <Reply size={18} color={c.muted} />
          </Pressable>
          {onCopy && (
            <>
              <View style={[styles.hairline, { backgroundColor: c.border }]} />
              <Pressable
                accessibilityRole="button"
                onPress={onCopy}
                style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: c.surface2 }]}
              >
                <Text style={[Type.callout, styles.menuLabel, { color: c.foreground }]}>Copy</Text>
                <Copy size={18} color={c.muted} />
              </Pressable>
            </>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

/** Tops of the pill and the menu, in order of preference: the web's split
 *  (pill above, menu below), both below (a bubble near the top), both above
 *  (a bubble near the bottom), else pinned to the safe edges. */
function placeVertically(anchor: Anchor, menuH: number, minTop: number, maxBottom: number) {
  const splitPill = anchor.top - 60;
  const splitMenu = anchor.bottom + 10;
  if (splitPill >= minTop && splitMenu + menuH <= maxBottom) {
    return { pillTop: splitPill, menuTop: splitMenu };
  }
  const belowPill = anchor.bottom + 10;
  if (splitPill < minTop && belowPill + PILL_STEP + menuH <= maxBottom) {
    return { pillTop: belowPill, menuTop: belowPill + PILL_STEP };
  }
  const aboveMenu = anchor.top - 10 - menuH;
  if (aboveMenu - PILL_STEP >= minTop) {
    return { pillTop: aboveMenu - PILL_STEP, menuTop: aboveMenu };
  }
  const pillTop = Math.max(minTop, Math.min(splitPill, maxBottom - menuH - PILL_STEP));
  const menuTop = Math.max(pillTop + PILL_STEP, Math.min(splitMenu, maxBottom - menuH));
  return { pillTop, menuTop };
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: SCRIM },
  pill: {
    position: "absolute",
    width: PILL_W,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    padding: 6,
  },
  emojiButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  // Web: active:scale-125.
  emojiPressed: { transform: [{ scale: 1.25 }] },
  emoji: { fontSize: 24, lineHeight: 30, textAlign: "center" },
  menu: { position: "absolute", width: MENU_W, borderRadius: Radius.lg },
  // Rounded clip on an inner view: overflow hidden on the shadow view would
  // clip the iOS shadow.
  menuClip: { borderRadius: Radius.lg, overflow: "hidden" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuLabel: { fontWeight: "500" },
  hairline: { height: StyleSheet.hairlineWidth },
});
