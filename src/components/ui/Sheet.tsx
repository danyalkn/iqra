import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { Elevation, Radius, SCRIM } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const OPEN_MS = 300;
/** Exit slide; exported so callers can wait for the Modal to leave (Today
 *  starts the celebration after it, as the web layered it above the sheet). */
export const CLOSE_MS = 220;
/** Drag past this (points) or faster than this (points/s) dismisses. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

/**
 * Bottom sheet, ported from reference/web-pwa/components/ui/Sheet.tsx:
 * backdrop, slide-up, tap-outside or swipe-down to dismiss, hardware back
 * closes it. Content is capped at 92% of the window like the web.
 *
 * `dragAnywhere` (default true) lets a drag on the whole panel dismiss it.
 * Pass false when the content is a ScrollView so the two gestures do not
 * fight; the grab handle strip always dismisses.
 *
 * Keyboard: the sheet lifts itself above the keyboard. RN's
 * KeyboardAvoidingView measures its own frame against the keyboard's window
 * coordinates, so it only works where the frame spans the window: here, at
 * the Modal root, not inside the bottom-anchored panel. Content must not add
 * its own KeyboardAvoidingView (it would double-pad); a ScrollView child
 * shrinks and scrolls because panel and panelInner both flexShrink. The root
 * also pads its top by the safe-area inset (+8) so the panel can never rise
 * into the status bar, in addition to the 92% cap.
 */
export function Sheet({
  open,
  onClose,
  children,
  dragAnywhere = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  dragAnywhere?: boolean;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  // `render` = open or mid-exit. The previous-open value is adjusted during
  // render (the React-sanctioned way to react to a prop flip) so the exit
  // animation can run after `open` turns false without a setState in an
  // effect body.
  const [prevOpen, setPrevOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setClosing(true);
  }
  const render = open || closing;
  const translateY = useSharedValue(windowH);
  const backdrop = useSharedValue(0);
  const panelH = useSharedValue(windowH);

  // The web waited a frame before sliding in so the transition ran; here the
  // Modal mounts, then the values animate from off-screen.
  useEffect(() => {
    if (open) {
      translateY.set(windowH);
      backdrop.set(0);
      translateY.set(withTiming(0, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) }));
      backdrop.set(withTiming(1, { duration: OPEN_MS }));
      return;
    }
    if (!closing) return;
    backdrop.set(withTiming(0, { duration: CLOSE_MS }));
    translateY.set(
      withTiming(panelH.get(), { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }),
    );
    const t = setTimeout(() => setClosing(false), CLOSE_MS);
    return () => clearTimeout(t);
    // translateY/backdrop/panelH are stable shared-value refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing, windowH]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  const pan = usePanGesture({
    // Downward drags only; an upward move lets any inner scroll take over.
    activeOffsetY: 8,
    failOffsetY: -12,
    onUpdate: (e) => {
      "worklet";
      translateY.set(Math.max(0, e.translationY));
      backdrop.set(1 - Math.min(1, Math.max(0, e.translationY) / panelH.get()) * 0.6);
    },
    onDeactivate: (e) => {
      "worklet";
      const shouldClose =
        e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY;
      if (shouldClose) {
        scheduleOnRN(requestClose);
      } else {
        translateY.set(withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }));
        backdrop.set(withTiming(1, { duration: 200 }));
      }
    },
  });

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.get() }));

  if (!render) return null;

  const handle = (
    <View style={styles.handleZone}>
      <View style={[styles.handle, { backgroundColor: c.border }]} />
    </View>
  );

  const panel = (
    <Animated.View
      accessibilityViewIsModal
      onLayout={(e) => panelH.set(e.nativeEvent.layout.height)}
      style={[
        styles.panel,
        Elevation.e3,
        // The shadow view needs an opaque fill too: RN logs a "cannot
        // calculate shadow efficiently" advisory on every layout otherwise.
        { backgroundColor: c.canvas, maxHeight: windowH * 0.92 },
        panelStyle,
      ]}
    >
      {/* Rounded clip lives on an inner view: overflow hidden on the shadow
          view would clip the iOS shadow. */}
      <View
        style={[
          styles.panelInner,
          { backgroundColor: c.canvas, paddingBottom: Math.max(28, insets.bottom) },
        ]}
      >
        {dragAnywhere ? handle : <GestureDetector gesture={pan}>{handle}</GestureDetector>}
        {children}
      </View>
    </Animated.View>
  );

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={requestClose}
    >
      {/* Modal is a separate native root on Android, so it needs its own
          gesture root for the pan to be recognized. */}
      <GestureHandlerRootView style={styles.fill}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          // The panel's own bottom padding (home indicator) doubles as the
          // gap above the keyboard instead of leaving an empty band.
          keyboardVerticalOffset={Platform.OS === "ios" ? -Math.max(28, insets.bottom) : 0}
          // Top padding keeps a tall panel (keyboard up) below the status bar /
          // Dynamic Island. It only shrinks the room flexShrink works with:
          // the open and drag animations translate the panel, not this root,
          // and the backdrop is absolutely positioned so it still covers all.
          style={[styles.root, { paddingTop: insets.top + 8 }]}
        >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.fill}
            onPress={requestClose}
          />
        </Animated.View>
        {dragAnywhere ? <GestureDetector gesture={pan}>{panel}</GestureDetector> : panel}
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  fill: { flex: 1 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: SCRIM },
  panel: {
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    // With the keyboard up the available height drops below the 92% cap; the
    // panel -> panelInner -> ScrollView chain shrinks instead of overflowing.
    flexShrink: 1,
  },
  panelInner: {
    borderTopLeftRadius: Radius["2xl"],
    borderTopRightRadius: Radius["2xl"],
    overflow: "hidden",
    // Let a ScrollView child shrink to the 92% cap instead of overflowing
    // off the top (tall forms: the log sheet, Edit profile with the keyboard).
    flexShrink: 1,
  },
  handleZone: { alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  handle: { width: 40, height: 6, borderRadius: 3 },
});
