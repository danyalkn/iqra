import { UserRound } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Placeholder } from "@/components/Placeholder";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/SessionProvider";

/**
 * Stub until Phase 1 ports reference/web-pwa/app/onboarding/OnboardingFlow.tsx
 * (name, mode, timezone, mushaf; first daily reminder). The gate sends a
 * signed-in account here only while `profiles` has no display_name or mode,
 * which is true for brand-new accounts only; every current member is past it.
 */
export default function OnboardingScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  return (
    <View style={[styles.root, { backgroundColor: c.canvas, paddingTop: insets.top }]}>
      <Placeholder
        icon={UserRound}
        title="Set up"
        note="Profile setup is coming in the next build. Sign out and come back once it lands, or ask the group owner to fill in your name and mode."
      >
        <Button variant="secondary" onPress={() => void signOut()}>
          Sign out
        </Button>
      </Placeholder>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
