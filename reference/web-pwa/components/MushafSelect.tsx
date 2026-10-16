"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MUSHAF_OPTIONS, type MushafId } from "@/lib/mushaf";
import { cn } from "@/lib/cn";

/** Pick the mushaf you read - drives the reading bookmark's page→juz/surah map
 *  and page range. Stored on the profile so it follows you across devices. */
export function MushafSelect({
  userId,
  initial,
}: {
  userId: string;
  initial: MushafId;
}) {
  const router = useRouter();
  const [value, setValue] = useState<MushafId>(initial);
  const [saving, setSaving] = useState<MushafId | null>(null);

  const choose = async (next: MushafId) => {
    if (next === value || saving) return;
    const prev = value;
    setValue(next);
    setSaving(next);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ mushaf: next })
      .eq("id", userId);
    setSaving(null);
    if (error) {
      setValue(prev);
      return;
    }
    router.refresh();
  };

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen className="size-4 text-muted" />
        <p className="text-callout font-semibold">Mushaf</p>
      </div>
      <div className="space-y-2">
        {MUSHAF_OPTIONS.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => choose(o.id)}
              aria-pressed={active}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                active
                  ? "border-accent bg-accent-tint"
                  : "border-border bg-surface-2",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-subhead font-medium">{o.label}</p>
                <p className="text-caption text-faint">{o.sub}</p>
              </div>
              {active && <Check className="size-5 shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-caption text-faint">
        Sets how your reading page maps to juz &amp; surah. Pages count the same
        either way.
      </p>
    </div>
  );
}
