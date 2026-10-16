"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn’t delete your account.");
      }
      // Clear any local session, then leave.
      await createClient().auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <div>
      <button
        onClick={() => {
          setOpen(true);
          setConfirm("");
          setError(null);
        }}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-subhead font-semibold text-danger"
      >
        <Trash2 className="size-4" />
        Delete my account &amp; all data
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="delete-title">
        <div className="px-5 pt-2">
          <div className="mb-3 grid size-12 place-items-center rounded-xl bg-danger-tint text-danger">
            <AlertTriangle className="size-6" />
          </div>
          <h2 id="delete-title" className="text-title2">
            Delete your account?
          </h2>
          <p className="mt-2 text-callout text-muted">
            This permanently deletes your profile, all your logs, messages,
            reminders, and notification settings. This cannot be undone.
          </p>

          <p className="mb-2 mt-5 text-footnote text-muted">
            Type <span className="font-semibold text-foreground">DELETE</span> to
            confirm.
          </p>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            autoCapitalize="characters"
          />

          {error && <p className="mt-3 text-footnote text-danger">{error}</p>}

          <div className="mt-6 flex gap-3">
            <Button variant="secondary" fullWidth onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              fullWidth
              loading={busy}
              disabled={confirm.trim().toUpperCase() !== "DELETE"}
              onClick={del}
            >
              Delete forever
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
