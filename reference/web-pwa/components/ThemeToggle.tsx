"use client";

import { useEffect, useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/cn";

type Theme = "system" | "light" | "dark";
const KEY = "iqra:theme";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Keep the status-bar / PWA chrome colour in sync with the canvas.
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0e0f0d" : "#faf8f3");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? "system";
    setTheme(saved);
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    localStorage.setItem(KEY, next);
    apply(next);
  };

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <p className="mb-3 text-callout font-semibold">Appearance</p>
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => choose(value)}
            aria-pressed={theme === value}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-subhead font-medium transition-colors",
              theme === value
                ? "bg-surface text-foreground shadow-e1"
                : "text-muted",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
