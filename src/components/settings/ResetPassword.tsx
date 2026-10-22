import { Eye, EyeOff, KeyRound } from "lucide-react-native";
import { useRef, useState, type ComponentRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { NavRow } from "@/components/profile/NavRow";
import { Button, Card, Input, Sheet, SheetFooter, SheetScroll } from "@/components/ui";
import { Radius, Type } from "@/constants/theme";
import { setPassword } from "@/data/account";
import { useTheme } from "@/hooks/use-theme";

/**
 * Settings row for a forgotten password (owner decision 2026-10-17). Being
 * signed in is enough: the sheet asks only for the new password twice, with
 * no old password and no email (there is no email service). Same rules as
 * sign-up on the login screen: at least 6 characters, both fields match.
 * The session stays signed in afterwards; USER_UPDATED just reloads the
 * profile in SessionProvider.
 */
export function ResetPassword() {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [password, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const start = () => {
    setPw("");
    setConfirm("");
    setShowPw(false);
    setError(null);
    setDone(false);
    setOpen(true);
  };

  const save = async () => {
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await setPassword(password);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Card style={styles.rows}>
        <NavRow
          first
          icon={KeyRound}
          iconColor={c.accent}
          iconBackground={c.accentTint}
          title="Reset password"
          note="Forgot it? Set a new one here."
          onPress={start}
        />
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)}>
        {/* The Sheet stays above the keyboard; on a small phone this scrolls. */}
        <SheetScroll contentContainerStyle={styles.sheetContent} bounces={false}>
          <View style={[styles.iconBox, { backgroundColor: c.accentTint }]}>
            <KeyRound size={24} color={c.accent} />
          </View>

          {done ? (
            <>
              <Text style={[Type.title2, { color: c.foreground }]}>Password updated</Text>
              <Text style={[Type.callout, styles.body, { color: c.muted }]}>
                Use your new password next time you sign in, here or on the web.
              </Text>
            </>
          ) : (
            <>
              <Text style={[Type.title2, { color: c.foreground }]}>Reset your password</Text>
              <Text style={[Type.callout, styles.body, { color: c.muted }]}>
                {"You're signed in, so you don't need the old one. Pick a new password."}
              </Text>

              <View style={styles.fields}>
                <View>
                  <Input
                    secureTextEntry={!showPw}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    accessibilityLabel="New password"
                    placeholder="New password"
                    value={password}
                    onChangeText={setPw}
                    style={styles.pwInput}
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => confirmRef.current?.focus()}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={showPw ? "Hide password" : "Show password"}
                    onPress={() => setShowPw((v) => !v)}
                    hitSlop={8}
                    style={styles.eye}
                  >
                    {showPw ? (
                      <EyeOff size={20} color={c.faint} />
                    ) : (
                      <Eye size={20} color={c.faint} />
                    )}
                  </Pressable>
                </View>
                <Input
                  ref={confirmRef}
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  accessibilityLabel="Confirm new password"
                  placeholder="Confirm new password"
                  value={confirm}
                  onChangeText={setConfirm}
                  returnKeyType="done"
                  onSubmitEditing={() => void save()}
                />
              </View>
            </>
          )}
        </SheetScroll>
        <SheetFooter>
          {done ? (
            <Button fullWidth style={styles.actionsTop} onPress={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              {error && (
                <Text style={[Type.footnote, styles.error, { color: c.danger }]}>{error}</Text>
              )}
              <View style={[styles.actions, styles.actionsTop]}>
                <Button
                  variant="secondary"
                  fullWidth
                  style={styles.grow}
                  onPress={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  fullWidth
                  style={styles.grow}
                  loading={busy}
                  disabled={!password || !confirm}
                  onPress={() => void save()}
                >
                  Save
                </Button>
              </View>
            </>
          )}
        </SheetFooter>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { padding: 0, overflow: "hidden" },
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
  fields: { marginTop: 20, gap: 12 },
  pwInput: { paddingRight: 44 },
  eye: { position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" },
  error: { marginTop: 12 },
  actions: { flexDirection: "row", gap: 12 },
  actionsTop: { marginTop: 24 },
  grow: { flex: 1 },
});
