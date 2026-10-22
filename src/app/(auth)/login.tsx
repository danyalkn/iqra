import { Eye, EyeOff } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMark } from "@/components/AppMark";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Radius, Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { isSupabaseConfigured, supabase } from "@/supabase/client";

type Mode = "signin" | "signup";

/** Keyboard up, the focused field keeps this much room under it: enough for
 *  the next field or the submit button to show on a small phone too. */
const FIELD_ROOM = 88;

/**
 * Ported from reference/web-pwa/app/login/LoginForm.tsx. Email + password
 * only (docs/DECISIONS.md § Auth): no OTP, no emailed reset link, paste
 * allowed. A forgotten password is reset from Settings while signed in; a
 * member signed out everywhere gets a temporary one from the owner first.
 * On success the session provider sees SIGNED_IN and the root gate moves
 * to onboarding or the tabs; nothing navigates here.
 *
 * Keyboard: keyboard-controller's KeyboardAwareScrollView on both
 * platforms. RN's KeyboardAvoidingView only worked on iOS: under
 * KeyboardProvider the Android window never resizes, so the keyboard
 * covered Create account.
 */
export default function LoginScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  const submit = async () => {
    setError(null);
    setNotice(null);

    const addr = email.trim().toLowerCase();
    if (!addr.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && addr !== confirmEmail.trim().toLowerCase()) {
      setError("Emails don't match. Double-check for typos.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (mode === "signup" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email: addr, password });
      if (error) {
        setLoading(false);
        setError(error.message);
        return;
      }
      // With "Confirm email" OFF, a session is returned immediately.
      if (!data.session) {
        setLoading(false);
        setNotice(
          "Account created. Email confirmation appears to be ON. Disable it in Supabase (Auth, Providers, Email), or confirm via the email, then sign in.",
        );
        setMode("signin");
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
      if (error) {
        setLoading(false);
        setError(error.message);
        return;
      }
    }
    // Leave `loading` on: the gate unmounts this screen on SIGNED_IN.
  };

  const toggleMode = () => {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setNotice(null);
    setConfirm("");
    setConfirmEmail("");
  };

  return (
    <KeyboardAwareScrollView
      style={[styles.root, { backgroundColor: c.canvas }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
      bottomOffset={FIELD_ROOM}
    >
      {!configured && (
        <View style={[styles.warn, { backgroundColor: c.warnTint, borderColor: c.warn }]}>
          <Text style={[Type.footnote, { color: c.foreground }]}>
            {"Supabase isn't configured yet. Copy .env.example to .env and restart the dev server."}
          </Text>
        </View>
      )}

      <AppMark />
      <Text style={[Type.display, styles.title, { color: c.foreground }]}>
        {mode === "signin" ? "Welcome to Iqra" : "Create your account"}
      </Text>
      <Text style={[Type.callout, styles.subtitle, { color: c.muted }]}>
        {mode === "signin"
          ? "Private Quran-study accountability for you and your circle."
          : "Sign up with an email and a password. You'll set your name next."}
      </Text>

      <View style={styles.fields}>
        <Input
          keyboardType="email-address"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          autoFocus
          accessibilityLabel="Email"
          placeholder="you@email.com"
          value={email}
          onChangeText={setEmail}
        />
        {mode === "signup" && (
          <Input
            keyboardType="email-address"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            accessibilityLabel="Confirm email"
            placeholder="Confirm email"
            value={confirmEmail}
            onChangeText={setConfirmEmail}
          />
        )}
        <View>
          <Input
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            textContentType={mode === "signin" ? "password" : "newPassword"}
            accessibilityLabel="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            style={styles.pwInput}
            onSubmitEditing={mode === "signin" ? submit : undefined}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPw ? "Hide password" : "Show password"}
            onPress={() => setShowPw((v) => !v)}
            hitSlop={8}
            style={styles.eye}
          >
            {showPw ? <EyeOff size={20} color={c.faint} /> : <Eye size={20} color={c.faint} />}
          </Pressable>
        </View>
        {mode === "signup" && (
          <Input
            secureTextEntry={!showPw}
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            accessibilityLabel="Confirm password"
            placeholder="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            onSubmitEditing={submit}
          />
        )}
      </View>

      {error && <Text style={[Type.footnote, styles.message, { color: c.danger }]}>{error}</Text>}
      {notice && (
        <Text
          style={[
            Type.footnote,
            styles.message,
            styles.notice,
            { color: c.foreground, backgroundColor: c.accentTint },
          ]}
        >
          {notice}
        </Text>
      )}

      <Button fullWidth loading={loading} onPress={submit} style={styles.submit}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </Button>

      <Pressable accessibilityRole="button" onPress={toggleMode} style={styles.toggle}>
        <Text style={[Type.subhead, { color: c.muted, textAlign: "center" }]}>
          {mode === "signin" ? "New here? " : "Already have an account? "}
          <Text style={{ color: c.accent, fontWeight: "600" }}>
            {mode === "signin" ? "Create an account" : "Sign in"}
          </Text>
        </Text>
      </Pressable>

      <Text style={[Type.footnote, styles.footer, { color: c.faint }]}>
        Stay signed in across launches. Forgot your password? Ask the group owner for a
        temporary one, then set your own in Profile.
      </Text>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  warn: {
    marginBottom: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { marginTop: 28 },
  subtitle: { marginTop: 8 },
  fields: { marginTop: 32, gap: 12 },
  pwInput: { paddingRight: 44 },
  eye: { position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" },
  message: { marginTop: 12 },
  notice: { borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  submit: { marginTop: 24 },
  toggle: { marginTop: 20 },
  footer: { marginTop: "auto", paddingTop: 32, paddingBottom: 16, textAlign: "center" },
});
