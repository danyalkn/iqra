import { UserRound } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";

/** Fifth tab (owner decision 2026-10-16: Profile replaces Journal in the
 *  tab bar; Journal is a stack screen opened from Today). Phase 1 decides
 *  what lives here beyond the profile card; see HANDOFF. */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Placeholder
        icon={UserRound}
        title="Profile"
        note="Your profile lands here in the next build."
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
