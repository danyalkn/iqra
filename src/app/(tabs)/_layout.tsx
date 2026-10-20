import { NativeTabs } from "expo-router/native-tabs";

import { useTheme } from "@/hooks/use-theme";

/**
 * The app's five tabs: Today, Feed, Chat, Insights, Profile. The web tab
 * bar was Today, Feed, Stats, Chat with Journal reached from Today; native
 * keeps Journal as a stack screen off Today, labels Stats "Insights" like
 * its page title, and adds Profile as the fifth tab (owner decision
 * 2026-10-16). SF Symbols on iOS (Lucide stays for in-screen icons).
 *
 * On iOS the bar is the system one: it is not restyled and it never
 * minimises while scrolling (owner decision 2026-10-18: the iOS 26
 * shrink-to-one-icon behaviour read as the bar disappearing). Android has
 * its own floating glass bar in _layout.android.tsx (owner decision
 * 2026-10-20), which Expo Router picks there instead of this file, so the
 * Android props here (the `md=` Material Symbols names, `indicatorColor`,
 * `rippleColor`) are no longer reached on a device. They stay because this
 * is still the base route file and must remain valid on every platform.
 */
export default function TabsLayout() {
  const c = useTheme();
  return (
    <NativeTabs
      tintColor={c.accent}
      iconColor={{ default: c.faint, selected: c.accent }}
      labelStyle={{ default: { color: c.faint }, selected: { color: c.accent } }}
      backgroundColor={c.surface}
      shadowColor={c.border}
      indicatorColor={c.accentTint}
      rippleColor={c.accentTint}
      minimizeBehavior="never"
    >
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar.badge.checkmark" md="event_available" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="feed">
        <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} md="chat_bubble" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="stats">
        <NativeTabs.Trigger.Label>Insights</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} md="bar_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
