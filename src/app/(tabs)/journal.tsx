import { NotebookPen } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";

/** Phase 1 ports reference/web-pwa/app/(app)/journal/JournalClient.tsx here. */
export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Placeholder
        icon={NotebookPen}
        title="Journal"
        note="Every entry and note you write collects here in the next build."
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
