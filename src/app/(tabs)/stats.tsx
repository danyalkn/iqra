import { useLocalSearchParams } from "expo-router";
import { ChartColumnBig } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";

/** Phase 2 ports reference/web-pwa/app/(app)/stats/StatsClient.tsx here.
 *  The Sunday recap push deep-links to /stats#recap on the web; natively it
 *  arrives as /stats?section=recap (src/lib/deepLinks.ts) and the port must
 *  scroll the recap card into view when `section === "recap"`. */
export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const { section } = useLocalSearchParams<{ section?: string }>();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Placeholder
        icon={ChartColumnBig}
        title="Insights"
        note={
          section === "recap"
            ? "Your weekly recap will open here once Insights lands in the next build."
            : "Your charts and insights show up here in the next build."
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
