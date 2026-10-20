import { BlurTargetView, BlurView } from "expo-blur";
import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from "expo-router/ui";
import {
  CalendarCheck,
  ChartColumn,
  CircleUserRound,
  MessageCircle,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import { useRef, type ComponentRef, type Ref, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type ViewProps } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  GLASS_BLUR,
  TAB_BAR_BOTTOM_GAP,
  TAB_BAR_HEIGHT,
  TAB_BAR_RADIUS,
  TAB_BAR_SIDE_MARGIN,
} from "@/constants/tabBar";
import { Type } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTheme } from "@/hooks/use-theme";

/** The host element a View ref points at (BlurTargetView, Pressable). */
type ViewRef = ComponentRef<typeof View>;

/** Extra slide past the bottom edge so the bar's shadow leaves with it. */
const SHADOW_ALLOWANCE = 24;

/** Theme colours are `#rrggbb`; the glass needs them see-through. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Live blur only where expo-blur can use the RenderNode API (Android 12,
 *  API 31). expo-blur's own "dimezisBlurViewSdk31Plus" fallback is not
 *  reliable on older Android: its SDK check runs in setBlurMethod, and the
 *  blur target id arrives in a later prop update that sets up a
 *  RenderScript blur anyway (review 2026-10-20). Gating here does not
 *  depend on prop order; below API 31 the bar is a solid tinted pill. */
const LIVE_BLUR =
  GLASS_BLUR &&
  Platform.OS === "android" &&
  typeof Platform.Version === "number" &&
  Platform.Version >= 31;

/** expo-blur's `tint` is a colour layer of its own over the blur (light:
 *  #f9f9f9 at 0.78 x intensity, dark: #191919 at 0.69 x intensity, see
 *  TintStyle.kt), so at intensity 70 it already covers 0.55 of the content
 *  in light and 0.48 in dark. These wash alphas on top make the stack land
 *  near the 70 percent (light) and 62 percent (dark) coverage that
 *  docs/ANDROID.md asks for: (1 - 0.55) x (1 - 0.34) leaves 0.30 of the
 *  content showing, (1 - 0.48) x (1 - 0.27) leaves 0.38. Tune on the
 *  emulator in both themes. With no live blur the bar is solid. */
const BLUR_INTENSITY = 70;
const WASH_ALPHA = { light: 0.34, dark: 0.27, solid: 0.96 } as const;

/**
 * Android tabs: expo-router/ui headless tabs with a floating, frosted,
 * Paper & Pine tinted bar, the Android take on the iOS 26 Liquid Glass bar
 * (owner decision 2026-10-20). The only file in the app that imports
 * expo-blur. Only src/app/(tabs)/_layout.android.tsx imports it, and on
 * iOS Metro resolves that import to the AndroidTabs.tsx fallback, so the
 * iOS bundle never contains this file or expo-blur.
 *
 * Every tab screen runs to the window bottom and the bar floats over it;
 * screens clear it with useTabBarClearance(). The screens sit inside one
 * BlurTargetView, the only content an Android BlurView can blur, and the
 * bar's BlurView sits outside it and after it, so it updates as the
 * content scrolls. Tabs stay mounted once visited (TabSlot), like
 * NativeTabs, and back behaves as NativeTabs did: back from any tab goes
 * to Today, back from Today leaves the app.
 */
export default function AndroidTabs() {
  const c = useTheme();
  const blurTarget = useRef<ViewRef>(null);
  return (
    <Tabs
      style={[styles.flex, { backgroundColor: c.canvas }]}
      options={{ backBehavior: "initialRoute" }}
    >
      <BlurTargetView ref={blurTarget} style={styles.flex}>
        <TabSlot />
      </BlurTargetView>
      {/* The triggers must be the direct children of GlassBar: Tabs finds
          them by reading TabList's child's children (asChild). */}
      <TabList asChild>
        <GlassBar blurTarget={blurTarget}>
          <TabTrigger name="today" href="/today" asChild>
            <TabButton label="Today" icon={CalendarCheck} />
          </TabTrigger>
          <TabTrigger name="feed" href="/feed" asChild>
            <TabButton label="Feed" icon={Users} />
          </TabTrigger>
          <TabTrigger name="chat" href="/chat" asChild>
            <TabButton label="Chat" icon={MessageCircle} />
          </TabTrigger>
          <TabTrigger name="stats" href="/stats" asChild>
            <TabButton label="Insights" icon={ChartColumn} />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton label="Profile" icon={CircleUserRound} />
          </TabTrigger>
        </GlassBar>
      </TabList>
    </Tabs>
  );
}

type GlassBarProps = ViewProps & { blurTarget: RefObject<ViewRef | null> };

/**
 * The floating bar. TabList (asChild) merges its own row style into
 * `style`; ours comes after it so our values win.
 *
 * Layers, bottom to top: the outer view's own tint (it also gives Android
 * elevation something to cast a shadow from, and is the whole tint where
 * there is no live blur, see LIVE_BLUR), the BlurView with expo-blur's own
 * tint layer (covers the outer tint where it renders), the Paper & Pine
 * wash (WASH_ALPHA), and a bright top hairline. The clip view rounds the
 * blur, since BlurView's own borderRadius is not applied reliably on
 * Android.
 *
 * It never minimises (DECISIONS 2026-10-18). While the keyboard is open it
 * slides off the bottom edge with it, so it never shows over the keyboard
 * or between the keyboard and Chat's composer (the composer's padding
 * assumes the bar is gone then; see chat.tsx).
 */
function GlassBar({ blurTarget, style, children, ...rest }: GlassBarProps) {
  const c = useTheme();
  const dark = useColorScheme() === "dark";
  const insets = useSafeAreaInsets();
  const { progress } = useReanimatedKeyboardAnimation();
  const hideDistance = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + insets.bottom + SHADOW_ALLOWANCE;
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.get() * hideDistance }],
  }));
  const tint = hexToRgba(
    c.surface,
    LIVE_BLUR ? (dark ? WASH_ALPHA.dark : WASH_ALPHA.light) : WASH_ALPHA.solid,
  );

  return (
    <Animated.View
      {...rest}
      style={[
        style,
        styles.bar,
        {
          bottom: insets.bottom + TAB_BAR_BOTTOM_GAP,
          backgroundColor: tint,
          borderColor: c.border,
          shadowColor: dark ? "#000000" : "#1c1b19",
        },
        slide,
      ]}
    >
      <View style={styles.clip}>
        {LIVE_BLUR ? (
          <BlurView
            blurTarget={blurTarget}
            blurMethod="dimezisBlurViewSdk31Plus"
            intensity={BLUR_INTENSITY}
            tint={dark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
        <View
          style={[
            styles.edge,
            { backgroundColor: dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.65)" },
          ]}
        />
      </View>
      <View accessibilityRole="tablist" style={styles.row}>
        {children}
      </View>
    </Animated.View>
  );
}

/** TabTriggerSlotProps types `ref` as React.RefAttributes<View>, which
 *  under RN 0.88 (View is a function component) names the component, not
 *  the host element Pressable takes; the ref is redeclared with the real
 *  instance type so it can pass straight through. */
type TabButtonProps = Omit<TabTriggerSlotProps, "ref"> & {
  ref?: Ref<ViewRef>;
  label: string;
  icon: LucideIcon;
};

/**
 * One tab. TabTrigger (asChild) merges onPress, onLongPress, isFocused and
 * href onto it; the row style it also merges is dropped on purpose. The
 * selected capsule is the Paper & Pine take on the iOS 26 selection
 * capsule and the Material active indicator the 1.0.0 APK showed. Touch
 * target: 52 tall (the 64 bar less 6 above and below) and at least 48 wide.
 */
function TabButton({
  label,
  icon: Icon,
  isFocused,
  href: _href,
  style: _style,
  ...rest
}: TabButtonProps) {
  const c = useTheme();
  const selected = !!isFocused;
  const color = selected ? c.accent : c.faint;
  return (
    <Pressable
      {...rest}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      android_ripple={{ color: c.accentTint, foreground: true }}
      style={styles.item}
    >
      <View style={[styles.capsule, selected && { backgroundColor: c.accentTint }]}>
        {/* Lucide has no filled variants, so the selected glyph gets a
            faint accent fill inside its outline, the part the SF Symbol
            .fill variants play on iOS, without losing the inner detail
            (the person in the circle, the calendar's check). */}
        <Icon
          size={22}
          color={color}
          strokeWidth={selected ? 2.4 : 1.8}
          fill={selected ? hexToRgba(c.accent, 0.18) : "none"}
        />
        {/* The system bars do not grow tab labels with the font scale;
            1.2 keeps "Insights" and the capsule inside a 63dp item on a
            360dp phone. TalkBack still reads the full label. */}
        <Text
          style={[Type.caption, { color, fontWeight: selected ? "600" : "500" }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    position: "absolute",
    left: TAB_BAR_SIDE_MARGIN,
    right: TAB_BAR_SIDE_MARGIN,
    height: TAB_BAR_HEIGHT,
    borderRadius: TAB_BAR_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 12,
  },
  clip: {
    ...StyleSheet.absoluteFill,
    borderRadius: TAB_BAR_RADIUS,
    overflow: "hidden",
  },
  edge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: 6,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 48,
    borderRadius: 24,
    overflow: "hidden",
    marginVertical: 6,
  },
  // 8 a side, not 12: on a 360dp-wide phone (Galaxy S default) each tab
  // gets about 63dp, and 12 a side left too little for "Insights".
  capsule: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    alignItems: "center",
    gap: 2,
    minWidth: 60,
  },
});
