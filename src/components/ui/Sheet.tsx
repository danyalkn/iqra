import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
} from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
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

import { focusedInputWithin } from "./focus";

const OPEN_MS = 300;
/** Exit slide; exported so callers can wait for the Modal to leave (Today
 *  starts the celebration after it, as the web layered it above the sheet). */
export const CLOSE_MS = 220;
/** Drag past this (points) or faster than this (points/s) dismisses. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
/** Space between the sheet's last row and the top of the open keyboard. */
const KEYBOARD_GAP = 8;

/**
 * Bottom sheet, ported from reference/web-pwa/components/ui/Sheet.tsx:
 * backdrop, slide-up, tap-outside or swipe-down to dismiss, hardware back
 * closes it. Content is capped at 92% of the window like the web.
 *
 * `dragAnywhere` (default true) lets a drag on the whole panel dismiss it.
 * Pass false when the content is a ScrollView so the two gestures do not
 * fight; the grab handle strip always dismisses.
 *
 * Keyboard: the panel stays on the window bottom and pads its content up
 * by keyboard-controller's keyboard height, frame by frame with the
 * keyboard's own animation, so the sheet's paper runs on behind the keys
 * (iOS 26's keyboard is translucent; a lifted panel showed the screen
 * under the sheet through it). RN's KeyboardAvoidingView lifted the sheet
 * on iOS only: keyboard-controller sets every Modal window on Android to
 * adjustNothing and reports the keyboard itself, so there a sheet never
 * moved and the keyboard covered its Save button (build 6, 2026-10-21).
 * Content must not add its own keyboard avoidance (it would double-pad); a
 * ScrollView child shrinks and scrolls because panel and panelInner both
 * flexShrink. The root also pads its top by the safe-area inset (+8) so the
 * panel can never rise into the status bar, in addition to the 92% cap.
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
  const bottomPad = Math.max(28, insets.bottom);
  // Negative while the keyboard is up, measured from the window bottom.
  const { height: keyboardH } = useReanimatedKeyboardAnimation();
  const translateY = useSharedValue(windowH);
  const backdrop = useSharedValue(0);
  const panelH = useSharedValue(windowH);
  const rootRef = useRef<ComponentRef<typeof View>>(null);

  // The web waited a frame before sliding in so the transition ran; here the
  // Modal mounts, then the values animate from off-screen.
  useEffect(() => {
    if (open) {
      // A field focused under the sheet (Chat's composer, onboarding's name)
      // would keep its keyboard up over the sheet: drop it. A field of the
      // sheet's own that focuses on open is left alone.
      if (TextInput.State.currentlyFocusedInput() && !focusedInputWithin(rootRef.current)) {
        Keyboard.dismiss();
      }
      translateY.set(windowH);
      backdrop.set(0);
      translateY.set(withTiming(0, { duration: OPEN_MS, easing: Easing.out(Easing.cubic) }));
      backdrop.set(withTiming(1, { duration: OPEN_MS }));
      return;
    }
    if (!closing) return;
    // Lower the keyboard with the sheet rather than after the Modal is gone.
    if (focusedInputWithin(rootRef.current)) Keyboard.dismiss();
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
      const shouldClose = e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY;
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
  // Home-indicator room while the keyboard is down; the keyboard's height
  // plus a small gap while it is up (it already covers the indicator).
  const innerStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(bottomPad, -keyboardH.get() + KEYBOARD_GAP),
  }));

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
      <Animated.View style={[styles.panelInner, { backgroundColor: c.canvas }, innerStyle]}>
        {dragAnywhere ? handle : <GestureDetector gesture={pan}>{handle}</GestureDetector>}
        {children}
      </Animated.View>
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
        {/* Top padding keeps a tall panel (keyboard up) below the status bar /
            Dynamic Island. It only caps the room flexShrink works with: the
            open and drag animations translate the panel, not this root, and
            the backdrop is absolutely positioned so it still covers all. */}
        <View ref={rootRef} style={[styles.root, { paddingTop: insets.top + 8 }]}>
          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.fill}
              onPress={requestClose}
            />
          </Animated.View>
          {dragAnywhere ? <GestureDetector gesture={pan}>{panel}</GestureDetector> : panel}
        </View>
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
