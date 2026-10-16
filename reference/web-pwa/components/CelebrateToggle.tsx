"use client";

import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { cn } from "@/lib/cn";
import { CELEBRATE_KEY } from "@/components/Celebration";

/** Settings switch for the log-a-reading celebration. Stored device-local so it
 *  needs no migration; read by TodayClient when a reading is logged. */
export function CelebrateToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    setOn(localStorage.getItem(CELEBRATE_KEY) !== "0");
  }, []);

  const toggle = () => {
    setOn((v) => {
      const next = !v;
      localStorage.setItem(CELEBRATE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-e1">
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-tint text-accent">
        <PartyPopper className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-callout font-semibold">Celebrate readings</p>
        <p className="text-footnote text-muted">
          {on
            ? "Confetti + a kind word when you log a reading."
            : "Off: log quietly."}
        </p>
      </div>
      <button
        onClick={toggle}
        aria-pressed={on}
        aria-label="Celebrate readings"
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors",
          on ? "bg-accent" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all",
            on ? "left-[1.375rem]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
