import { StyleSheet, Text, View } from "react-native";

import { Button, Sheet } from "@/components/ui";
import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * Where the totals come from: only what was logged in Iqra (web: the
 * coverage Sheet at the end of StatsClient.tsx). Opened from the info
 * affordance on the "All-time pages" tile in both scopes.
 */
export function CoverageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useTheme();
  const para = [Type.subhead, styles.para, { color: c.muted }];
  return (
    <Sheet open={open} onClose={onClose}>
      <View style={styles.content}>
        <Text style={[Type.title2, { color: c.foreground }]}>About these numbers</Text>
        <View style={styles.paras}>
          <Text style={para}>
            Every total here is built from what’s been logged in Iqra, nothing else. If you read
            without logging it, or started reading before joining, that isn’t counted.
          </Text>
          <Text style={para}>
            So treat these as{" "}
            <Text style={[styles.bold, { color: c.foreground }]}>
              a record of what we’ve tracked together
            </Text>
            , not a complete account of what anyone has read. The real number is only ever higher.
          </Text>
          <Text style={para}>
            Pages are normalised to the 604-page Uthmani mushaf, so a juz counts as 20 pages and a
            quarter as 5. Entries logged in ayahs don’t carry a page count and sit outside these
            totals.
          </Text>
        </View>
        <Button fullWidth onPress={onClose} style={styles.button}>
          Got it
        </Button>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  paras: { marginTop: 16, gap: 12 },
  para: { fontWeight: "400" },
  bold: { fontWeight: "600" },
  button: { marginTop: 24 },
});
