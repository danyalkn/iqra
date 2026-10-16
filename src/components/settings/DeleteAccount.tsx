import { AlertTriangle, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Input, Sheet } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { deleteAccount } from "@/data/account";
import { useTheme } from "@/hooks/use-theme";
import { useSession } from "@/providers/SessionProvider";

/**
 * Ported from reference/web-pwa/components/DeleteAccount.tsx. The server-side
 * work (auth user removal, cascading to every table) lives in
 * src/data/account.ts. After it succeeds the local session is dropped with
 * signOut(); the root gate then flips to login, so nothing navigates by hand
 * (the web did router.replace("/login")).
 */
export function DeleteAccount() {
  const c = useTheme();
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      // Clear any local session, then leave (the gate takes it from here).
      await signOut();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setOpen(true);
          setConfirm("");
          setError(null);
        }}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Trash2 size={16} color={c.danger} />
        <Text style={[Type.subhead, styles.semibold, { color: c.danger }]}>
          Delete my account & all data
        </Text>
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)}>
          {/* The Sheet lifts itself above the keyboard. */}
          <View style={styles.sheetContent}>
            <View style={[styles.iconBox, { backgroundColor: c.dangerTint }]}>
              <AlertTriangle size={24} color={c.danger} />
            </View>
            <Text style={[Type.title2, { color: c.foreground }]}>Delete your account?</Text>
            <Text style={[Type.callout, styles.body, { color: c.muted }]}>
              This permanently deletes your profile, all your logs, messages, reminders, and
              notification settings. This cannot be undone.
            </Text>

            <Text style={[Type.footnote, styles.prompt, { color: c.muted }]}>
              Type <Text style={[styles.semibold, { color: c.foreground }]}>DELETE</Text> to
              confirm.
            </Text>
            <Input
              value={confirm}
              onChangeText={setConfirm}
              placeholder="DELETE"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
            />

            {error && (
              <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>
            )}

            <View style={styles.actions}>
              <Button
                variant="secondary"
                fullWidth
                style={styles.grow}
                onPress={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                fullWidth
                style={styles.grow}
                loading={busy}
                disabled={confirm.trim().toUpperCase() !== "DELETE"}
                onPress={() => void del()}
              >
                Delete forever
              </Button>
            </View>
          </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.md,
  },
  pressed: { opacity: 0.7 },
  semibold: { fontWeight: "600" },
  sheetContent: { paddingHorizontal: 20, paddingTop: 8 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  body: { marginTop: 8 },
  prompt: { marginTop: 20, marginBottom: 8 },
  error: { marginTop: 12 },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  grow: { flex: 1 },
});
