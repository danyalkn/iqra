import { MessageCircle } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";

/** Phase 2 ports reference/web-pwa/app/(app)/chat/ChatClient.tsx here.
 *  Deep link target for chat, mention, and nudge pushes (`/chat`). */
export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Placeholder
        icon={MessageCircle}
        title="Chat"
        note="Your circle's shared chat shows up here in the next build."
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
