import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const ITEM_H = 40;
const VISIBLE = 5; // odd → middle row is the selection
const PAD = ((VISIBLE - 1) / 2) * ITEM_H;
const HEIGHT = VISIBLE * ITEM_H;
/** Web: the fade ran from each edge to 40% of the height = the padding. */
const FADE_H = PAD;

function clampIndex(idx: number, len: number): number {
  return Math.min(len - 1, Math.max(0, idx));
}

/** iOS-style scroll wheel (reference/web-pwa/components/WheelPicker.tsx).
 *  Snaps to a centered option (snapToInterval plus a hard snap once it
 *  settles, so it stays deterministic) and reports it once scrolling stops.
 *  Sits inside a surface Card: the edge fades are drawn in that colour. */
export function WheelPicker<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  const c = useTheme();
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set around every scrollTo we issue, so our own scrolls never re-fire
  // onChange or a haptic tick.
  const programmatic = useRef(false);
  const targetIdx = Math.max(0, options.indexOf(value));
  // The option set as a string: `options` is often a fresh array each render
  // (e.g. the part options), and the web keyed its sync effect on length for
  // the same reason. Joining is cheap at these sizes (≤ ~100 rows).
  const optionsKey = options.map(String).join("|");
  const [active, setActive] = useState(targetIdx);
  // Mirror of `active` for the scroll handler: scroll events arrive faster
  // than renders, and the haptic must tick once per row, not once per event.
  const activeRef = useRef(targetIdx);
  // Only honoured at mount, so the wheel appears on the right row instead of
  // jumping there a frame later.
  const [initialOffset] = useState(() => ({ x: 0, y: targetIdx * ITEM_H }));

  const scrollToIndex = useCallback((idx: number, animated: boolean) => {
    const el = scroller.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({ y: idx * ITEM_H, animated });
    // release the guard after the scroll has applied
    if (release.current) clearTimeout(release.current);
    release.current = setTimeout(() => (programmatic.current = false), animated ? 320 : 60);
  }, []);

  // Sync position when the value / option-set changes externally.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      // Already on our way there (a tap's animated scroll, or the hard snap
      // that just reported this value): don't cut it short with a jump.
      if (programmatic.current && activeRef.current === targetIdx) return;
      activeRef.current = targetIdx;
      setActive(targetIdx);
      scrollToIndex(targetIdx, false);
    });
    return () => cancelAnimationFrame(id);
    // optionsKey stands in for `options`: same rows, same scroll position.
  }, [targetIdx, optionsKey, scrollToIndex]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
      if (release.current) clearTimeout(release.current);
    },
    [],
  );

  const indexAt = (y: number) => clampIndex(Math.round(y / ITEM_H), options.length);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (programmatic.current) return;
    const idx = indexAt(e.nativeEvent.contentOffset.y);
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActive(idx);
      // The detent tick of a real picker wheel.
      Haptics.selectionAsync();
    }
  };

  // Hard-snap to the centered row and report it. Called once the wheel is at
  // rest: after momentum ends, or 120ms after a drag that started none.
  const commit = (y: number) => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
    const idx = indexAt(y);
    activeRef.current = idx;
    setActive(idx);
    scrollToIndex(idx, false);
    if (options[idx] !== value) onChange(options[idx]);
  };

  const onScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (programmatic.current) return;
    const y = e.nativeEvent.contentOffset.y;
    if (settle.current) clearTimeout(settle.current);
    // A release that coasts fires onMomentumScrollBegin before this timer and
    // cancels it; a dead-stop release has nothing else coming, so commit.
    settle.current = setTimeout(() => commit(y), 120);
  };

  const onMomentumScrollBegin = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (programmatic.current) return;
    commit(e.nativeEvent.contentOffset.y);
  };

  return (
    <View style={styles.root}>
      {/* selection band */}
      <View
        pointerEvents="none"
        style={[styles.band, { backgroundColor: c.surface2 }]}
      />
      <ScrollView
        ref={scroller}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentOffset={initialOffset}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={styles.scroller}
      >
        {options.map((o, i) => (
          <Pressable
            key={String(o)}
            accessibilityRole="button"
            // Web: role="listbox" aria-label on the column. Several wheels sit
            // side by side, so the wheel's name rides on every row ("Juz 3")
            // for a screen reader to tell them apart.
            accessibilityLabel={ariaLabel ? `${ariaLabel} ${String(o)}` : undefined}
            accessibilityState={{ selected: i === active }}
            onPress={() => {
              activeRef.current = i;
              setActive(i);
              scrollToIndex(i, true);
              onChange(o);
            }}
            style={styles.row}
          >
            <Text
              style={[
                // colors only - transitioning font-size reflowed on every
                // scroll tick and made the wheel feel laggy.
                styles.rowText,
                i === active
                  ? [Type.title3, { color: c.foreground }]
                  : [Type.callout, { color: c.faint }],
              ]}
            >
              {String(o)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {/* top/bottom fade, in the Card's surface colour */}
      <Svg pointerEvents="none" style={styles.fade} width="100%" height={HEIGHT}>
        <Defs>
          <LinearGradient id="wheelFadeTop" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.surface} stopOpacity={1} />
            <Stop offset="1" stopColor={c.surface} stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="wheelFadeBottom" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.surface} stopOpacity={0} />
            <Stop offset="1" stopColor={c.surface} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={FADE_H} fill="url(#wheelFadeTop)" />
        <Rect
          x="0"
          y={HEIGHT - FADE_H}
          width="100%"
          height={FADE_H}
          fill="url(#wheelFadeBottom)"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: HEIGHT, position: "relative" },
  band: {
    position: "absolute",
    left: 4,
    right: 4,
    top: PAD,
    height: ITEM_H,
    borderRadius: Radius.sm,
  },
  scroller: { height: HEIGHT },
  content: { paddingVertical: PAD },
  row: { height: ITEM_H, alignItems: "center", justifyContent: "center" },
  rowText: { fontVariant: ["tabular-nums"] },
  fade: { position: "absolute", top: 0, left: 0, right: 0, height: HEIGHT },
});
