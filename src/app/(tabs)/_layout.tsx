import { NativeTabs } from "expo-router/native-tabs";

import { useTheme } from "@/hooks/use-theme";

/**
 * The app's five tabs (HANDOFF § Phase 0). The web tab bar was Today, Feed,
 * Stats, Chat with Journal reached from Today; native promotes Journal to a
 * tab and labels Stats "Insights" like its page title. SF Symbols on iOS,
 * Material Symbols on Android (Lucide stays for in-screen icons).
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
      minimizeBehavior="onScrollDown"
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
      <NativeTabs.Trigger name="journal">
        <NativeTabs.Trigger.Label>Journal</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "book.closed", selected: "book.closed.fill" }} md="menu_book" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
