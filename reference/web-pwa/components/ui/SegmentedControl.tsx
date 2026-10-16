"use client";

import { cn } from "@/lib/cn";

export type Segment<T extends string> = { value: T; label: string };

/** iOS-style segmented control - surface pill slides over a surface-2 track. */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  size = "md",
  className,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex rounded-xl bg-surface-2 p-1",
        size === "sm" ? "text-subhead" : "text-subhead",
        className,
      )}
    >
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(s.value)}
            className={cn(
              "flex-1 rounded-lg py-1.5 font-medium transition-colors",
              active ? "bg-surface text-foreground shadow-e1" : "text-muted",
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
