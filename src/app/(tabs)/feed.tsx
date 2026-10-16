import { Users } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";

/** Phase 2 ports reference/web-pwa/app/(app)/feed/FeedClient.tsx here. */
export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Placeholder
        icon={Users}
        title="Feed"
        note="Your circle's activity shows up here in the next build."
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
