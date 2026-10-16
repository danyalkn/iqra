import { Copy, Reply } from "lucide-react-native";
import { useEffect } from "react";
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
  onCopy: () => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const { width: vw } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Same placement as the web: anchored to the bubble's edge on the sender's
  // side, clamped 8 from the screen edges; the pill goes 60 above when there
  // is room, else 10 below, and the menu sits 10 under the bubble or 56
  // under the pill.
  const clampX = (x: number, w: number) => Math.min(Math.max(x, 8), vw - w - 8);
  const pillLeft = clampX(mine ? anchor.right - PILL_W : anchor.left, PILL_W);
  const menuLeft = clampX(mine ? anchor.right - MENU_W : anchor.left, MENU_W);
  const roomAbove = anchor.top - 64 >= 12;
  const pillTop = roomAbove ? anchor.top - 60 : anchor.bottom + 10;
  const menuTop = roomAbove ? anchor.bottom + 10 : pillTop + 56;

  // Web: animate-[dialIn_170ms] on the pill and 190ms on the menu (scale +
  // fade with the spring ease). Reduce motion skips straight to the end.
  const pillIn = useSharedValue(reduceMotion ? 1 : 0);
  const menuIn = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    const easing = Easing.out(Easing.back(1.6));
    pillIn.set(withTiming(1, { duration: 170, easing }));
    menuIn.set(withTiming(1, { duration: 190, easing }));
    // pillIn/menuIn are stable shared-value refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);
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
          <View style={[styles.hairline, { backgroundColor: c.border }]} />
          <Pressable
            accessibilityRole="button"
            onPress={onCopy}
            style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: c.surface2 }]}
          >
            <Text style={[Type.callout, styles.menuLabel, { color: c.foreground }]}>Copy</Text>
            <Copy size={18} color={c.muted} />
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
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
