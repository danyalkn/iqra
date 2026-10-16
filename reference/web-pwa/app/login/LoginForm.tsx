"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AppMark } from "@/components/AppMark";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

type Mode = "signin" | "signup";

export function LoginForm({
  configured,
  initialMode = "signin",
}: {
  configured: boolean;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const addr = email.trim().toLowerCase();
    if (!addr.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (mode === "signup" && addr !== confirmEmail.trim().toLowerCase()) {
      setError("Emails don’t match. Double-check for typos.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (mode === "signup" && password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: addr,
        password,
      });
      if (error) {
        setLoading(false);
        setError(error.message);
        return;
      }
      // With "Confirm email" OFF, a session is returned immediately.
      if (!data.session) {
        setLoading(false);
        setNotice(
          "Account created. Email confirmation appears to be ON. Disable it in Supabase (Auth → Providers → Email), or confirm via the email, then sign in.",
        );
        setMode("signin");
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: addr,
        password,
      });
      if (error) {
        setLoading(false);
        setError(error.message);
        return;
      }
    }

    // Session cookie is set; root route decides onboarding vs app.
    router.replace("/");
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-16">
      {!configured && (
        <div className="mb-6 rounded-xl border border-warn/30 bg-warn-tint px-4 py-3 text-footnote text-foreground">
          Supabase isn’t configured yet. Add your keys to{" "}
          <code className="font-mono">.env.local</code> (see docs/SETUP.md).
        </div>
      )}

      <form onSubmit={submit} className="flex flex-1 flex-col">
        <AppMark />
        <h1 className="mt-7 text-display">
          {mode === "signin" ? "Welcome to Iqra" : "Create your account"}
        </h1>
        <p className="mt-2 text-callout text-muted">
          {mode === "signin"
            ? "Private Quran-study accountability for you and your circle."
            : "Sign up with an email and a password. You’ll set your name next."}
        </p>

        <div className="mt-8 space-y-3">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode === "signup" && (
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder="Confirm email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
            />
          )}
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-faint"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? (
                <EyeOff className="size-5" />
              ) : (
                <Eye className="size-5" />
              )}
            </button>
          </div>
          {mode === "signup" && (
            <Input
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </div>

        {error && <p className="mt-3 text-footnote text-danger">{error}</p>}
        {notice && (
          <p className="mt-3 rounded-lg bg-accent-tint px-3 py-2 text-footnote text-foreground">
            {notice}
          </p>
        )}

        <Button type="submit" fullWidth loading={loading} className="mt-6">
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError(null);
            setNotice(null);
            setConfirm("");
            setConfirmEmail("");
          }}
          className="mt-5 text-center text-subhead text-muted"
        >
          {mode === "signin" ? (
            <>
              New here?{" "}
              <span className="font-semibold text-accent">Create an account</span>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <span className="font-semibold text-accent">Sign in</span>
            </>
          )}
        </button>

        <p
          className={cn(
            "mt-auto pb-10 pt-8 text-center text-footnote text-faint",
          )}
        >
          Stay signed in across launches. Forgot your password? Ask the group
          owner to reset it.
        </p>
      </form>
    </main>
  );
}
