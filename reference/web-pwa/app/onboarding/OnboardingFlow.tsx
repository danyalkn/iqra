"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookMarked,
  BookOpen,
  Check,
  Clock,
  Globe,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Mode } from "@/lib/entries";
import type { Profile } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Input, FieldLabel } from "@/components/ui/Field";
import { AddToHomeScreen } from "@/components/AddToHomeScreen";

const MODE_CARDS: {
  mode: Mode;
  icon: typeof BookMarked;
  title: string;
  sub: string;
  desc: string;
}[] = [
  {
    mode: "hifz",
    icon: BookMarked,
    title: "Memorizing",
    sub: "Hifz",
    desc: "Track sabak, sabak para, and dhor.",
  },
  {
    mode: "reading",
    icon: BookOpen,
    title: "Reading",
    sub: "Cover to cover",
    desc: "Log reading and revising.",
  },
];

export function OnboardingFlow({
  userId,
  email,
  initial,
}: {
  userId: string;
  email: string;
  initial: Profile | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode | null>(initial?.mode ?? null);
  const [name, setName] = useState(
    initial?.display_name ?? email.split("@")[0] ?? "",
  );
  const [timezone] = useState(
    () =>
      initial?.timezone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC",
  );
  const [reminderOn, setReminderOn] = useState(
    initial?.reminder_time ? true : true,
  );
  const [reminderTime, setReminderTime] = useState(
    initial?.reminder_time?.slice(0, 5) ?? "06:00",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveProfile = async () => {
    setError(null);
    if (!mode) return;
    if (!name.trim()) {
      setError("Please enter a display name.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      display_name: name.trim(),
      mode,
      timezone,
      reminder_time: null, // superseded by the reminders table
    });
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    // Create the first daily reminder (managed later in Settings).
    if (reminderOn) {
      await supabase.from("reminders").insert({
        user_id: userId,
        time: reminderTime,
        days: [0, 1, 2, 3, 4, 5, 6],
        enabled: true,
      });
    }
    setSaving(false);
    setStep(2);
  };

  const finish = () => {
    router.replace("/today");
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-14">
      {/* progress */}
      <p className="text-footnote font-medium uppercase tracking-wider text-faint">
        Step {step + 1} of 3
      </p>

      {step === 0 && (
        <>
          <h1 className="mt-2 text-title1">What are you working on?</h1>
          <p className="mt-2 text-callout text-muted">
            This sets your log options and default charts. You can change it
            later in Settings.
          </p>
          <div className="mt-7 space-y-3">
            {MODE_CARDS.map((c) => {
              const selected = mode === c.mode;
              return (
                <button
                  key={c.mode}
                  onClick={() => setMode(c.mode)}
                  className={cn(
                    "flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition",
                    selected
                      ? "border-accent bg-accent-tint/60 shadow-e1"
                      : "border-border bg-surface",
                  )}
                >
                  <div
                    className={cn(
                      "grid size-11 shrink-0 place-items-center rounded-xl",
                      selected
                        ? "bg-accent text-on-accent"
                        : "bg-surface-2 text-muted",
                    )}
                  >
                    <c.icon className="size-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-callout font-semibold">{c.title}</h3>
                      {selected && (
                        <span className="grid size-5 place-items-center rounded-full bg-accent text-on-accent">
                          <Check className="size-3.5" strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <p className="text-footnote font-medium text-faint">
                      {c.sub}
                    </p>
                    <p className="mt-1 text-footnote text-muted">{c.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <Button
            className="mt-auto mb-10"
            fullWidth
            disabled={!mode}
            onClick={() => setStep(1)}
          >
            Continue
          </Button>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="mt-2 text-title1">Your profile</h1>
          <p className="mt-2 text-callout text-muted">
            How you’ll show up to your circle.
          </p>

          <div className="mt-7 space-y-5">
            <div>
              <FieldLabel>Display name</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoFocus
                maxLength={40}
              />
            </div>

            <div>
              <FieldLabel>Time zone</FieldLabel>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-3 text-callout text-muted">
                <Globe className="size-4 text-faint" />
                {timezone}
              </div>
              <p className="mt-1.5 px-1 text-footnote text-faint">
                Detected automatically · used for reminders and streaks.
              </p>
            </div>

            <div>
              <FieldLabel>Daily reminder</FieldLabel>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setReminderOn((v) => !v)}
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                    reminderOn ? "bg-accent" : "bg-border",
                  )}
                  aria-pressed={reminderOn}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all",
                      reminderOn ? "left-[1.375rem]" : "left-0.5",
                    )}
                  />
                </button>
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
                  <Clock className="size-4 text-faint" />
                  <input
                    type="time"
                    value={reminderTime}
                    disabled={!reminderOn}
                    onChange={(e) => setReminderTime(e.target.value)}
                    className="flex-1 bg-transparent text-callout text-foreground outline-none disabled:opacity-40"
                  />
                </div>
              </div>
              <p className="mt-1.5 px-1 text-footnote text-faint">
                One gentle nudge a day, at your local time.
              </p>
            </div>
          </div>

          {error && <p className="mt-4 text-footnote text-danger">{error}</p>}

          <div className="mt-auto mb-10 flex gap-3 pt-8">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button fullWidth loading={saving} onClick={saveProfile}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="mt-2 text-title1">Install Iqra</h1>
          <p className="mt-2 text-callout text-muted">
            Add Iqra to your Home Screen so it opens like an app, and so push
            notifications work (required on iPhone).
          </p>
          <div className="mt-7">
            <AddToHomeScreen />
          </div>
          <Button className="mt-auto mb-10" fullWidth onClick={finish}>
            Enter Iqra
          </Button>
        </>
      )}
    </main>
  );
}
