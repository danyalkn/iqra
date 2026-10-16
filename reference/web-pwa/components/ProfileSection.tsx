"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ENTRY_META, TYPES_BY_MODE, type Mode } from "@/lib/entries";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input, FieldLabel } from "@/components/ui/Field";

export function ProfileSection({
  userId,
  email,
  initial,
}: {
  userId: string;
  email: string;
  initial: { display_name: string; mode: Mode; timezone: string; avatar_url: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial.display_name);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC";

  const save = async () => {
    if (!name.trim()) {
      setError("Name can’t be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name.trim(), mode, timezone })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  };

  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl bg-surface p-4 text-left shadow-e1"
      >
        <Avatar name={initial.display_name} src={initial.avatar_url} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-callout font-semibold">
            {initial.display_name}
          </p>
          <p className="truncate text-footnote text-muted">{email}</p>
          <p className="truncate text-footnote text-faint">
            {mode === "hifz" ? "Memorizing (Hifz)" : "Reading"} ·{" "}
            {TYPES_BY_MODE[mode].map((t) => ENTRY_META[t].label).join(" · ")}
          </p>
        </div>
        <Pencil className="size-4 shrink-0 text-faint" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="profile-edit-title">
        <div className="px-5 pt-2">
          <h2 id="profile-edit-title" className="mb-5 text-title2">
            Edit profile
          </h2>

          <FieldLabel>Display name</FieldLabel>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />

          <div className="mt-5">
            <FieldLabel>Mode</FieldLabel>
            <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
              {(
                [
                  { v: "hifz", label: "Memorizing" },
                  { v: "reading", label: "Reading" },
                ] as { v: Mode; label: string }[]
              ).map((o) => (
                <button
                  key={o.v}
                  onClick={() => setMode(o.v)}
                  className={cn(
                    "flex-1 rounded-lg py-1.5 font-medium transition-colors",
                    mode === o.v
                      ? "bg-surface text-foreground shadow-e1"
                      : "text-muted",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-2 px-1 text-footnote text-faint">
              Changes your log options and default charts.
            </p>
          </div>

          <div className="mt-5">
            <FieldLabel>Time zone</FieldLabel>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            {detected && detected !== timezone && (
              <button
                onClick={() => setTimezone(detected)}
                className="mt-2 text-footnote font-medium text-accent"
              >
                Use detected ({detected})
              </button>
            )}
          </div>

          {error && <p className="mt-3 text-footnote text-danger">{error}</p>}

          <div className="mt-6 flex gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button fullWidth onClick={save} loading={saving}>
              Save
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
