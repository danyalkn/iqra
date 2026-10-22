import { createContext, useCallback, useContext, useRef, type ComponentRef } from "react";
import {
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";
import { useKeyboardHandler } from "react-native-keyboard-controller";
import { scheduleOnRN } from "react-native-worklets";

import { focusedInputWithin } from "./focus";

/** Room kept between a revealed field and the scroll view's edges. */
const MARGIN = 16;

const RevealContext = createContext<(() => void) | null>(null);

/** Scrolls the nearest SheetScroll so the focused field shows. Null outside
 *  one; Field's Input calls it on focus and as a multiline field grows. */
export function useRevealFocused() {
  return useContext(RevealContext);
}

/**
 * The ScrollView for Sheet content with text fields. The Sheet already keeps
 * itself above the keyboard and lets this shrink, but iOS never scrolls a
 * focused field into view, so a field low in a long form (Log's notes, a
 * reminder's note) sat under the fold with the keyboard up while the member
 * typed blind. This brings the focused field into view when the keyboard
 * settles (it opens, or changes height between number pad and letters), when
 * a field gains focus with the keyboard already up, and as a note grows.
 * Android's ScrollView does the same natively; there this usually finds the
 * field already in view and does nothing.
 *
 * Defaults to flexShrink 1 and keyboardShouldPersistTaps "handled", which
 * every sheet form needs (a tap on Save with the keyboard up must save, not
 * only dismiss the keyboard).
 */
export function SheetScroll({
  style,
  onScroll,
  keyboardShouldPersistTaps = "handled",
  showsVerticalScrollIndicator = false,
  children,
  ...rest
}: Omit<ScrollViewProps, "ref">) {
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);

  const reveal = useCallback(() => {
    const scroll = ref.current;
    const host = scroll?.getNativeScrollRef();
    // A field in a sheet stacked over this one (the time zone picker over
    // Edit profile) is not ours to scroll to.
    const input = focusedInputWithin(host);
    if (!scroll || !host || !input) return;
    host.measureInWindow((_sx, sy, _sw, sh) => {
      input.measureInWindow((_ix, iy, _iw, ih) => {
        if (sh <= 0) return;
        const below = iy + ih + MARGIN - (sy + sh);
        const above = iy - MARGIN - sy;
        // Bring the bottom into view without pushing the top out (a field
        // taller than the room left shows its top, where the caret starts).
        const delta = below > 0 ? Math.min(below, above) : above < 0 ? above : 0;
        // The sheet may have closed while the measures were in flight.
        if (Math.abs(delta) < 1 || ref.current !== scroll) return;
        scroll.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
      });
    });
  }, []);

  // A frame later, so the sheet's last keyboard padding has been laid out.
  const revealSoon = useCallback(() => {
    requestAnimationFrame(reveal);
  }, [reveal]);

  useKeyboardHandler(
    {
      onEnd: (e) => {
        "worklet";
        if (e.height > 0) scheduleOnRN(revealSoon);
      },
    },
    [revealSoon],
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
      onScroll?.(e);
    },
    [onScroll],
  );

  return (
    <RevealContext.Provider value={revealSoon}>
      <ScrollView
        ref={ref}
        style={[styles.shrink, style]}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        {...rest}
      >
        {children}
      </ScrollView>
    </RevealContext.Provider>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
});
