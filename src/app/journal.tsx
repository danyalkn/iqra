import { router } from "expo-router";
import { ArrowLeft, NotebookPen } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";
import { useTheme } from "@/hooks/use-theme";

/** Stack screen over the tabs, opened from Today (as on the web). Phase 1
 *  ports reference/web-pwa/app/(app)/journal/JournalClient.tsx here. */
export default function JournalScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { backgroundColor: c.canvas, paddingTop: insets.top }]}>
      <Placeholder
        icon={NotebookPen}
        title="Journal"
        note="Every entry and note you write collects here in the next build."
        headerRight={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/today"))}
            hitSlop={8}
            style={[styles.back, { backgroundColor: c.surface2 }]}
          >
            <ArrowLeft size={20} color={c.muted} />
          </Pressable>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
