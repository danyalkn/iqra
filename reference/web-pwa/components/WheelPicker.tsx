"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const ITEM_H = 40;
const VISIBLE = 5; // odd → middle row is the selection
const PAD = ((VISIBLE - 1) / 2) * ITEM_H;

/** iOS-style scroll wheel. Snaps to a centered option (snapping done in JS so
 *  it stays deterministic) and reports it once scrolling settles. */
export function WheelPicker<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmatic = useRef(false);
  const [active, setActive] = useState(() =>
    Math.max(0, options.indexOf(value)),
  );

  const scrollToIndex = (idx: number, smooth = false) => {
    const el = ref.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({ top: idx * ITEM_H, behavior: smooth ? "smooth" : "auto" });
    // release the guard after the scroll has applied
    setTimeout(() => (programmatic.current = false), smooth ? 320 : 60);
  };

  // Sync position when the value / option-set changes externally.
  useEffect(() => {
    const idx = Math.max(0, options.indexOf(value));
    setActive(idx);
    const id = requestAnimationFrame(() => scrollToIndex(idx));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.length]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || programmatic.current) return;
    const idx = Math.min(
      options.length - 1,
      Math.max(0, Math.round(el.scrollTop / ITEM_H)),
    );
    if (idx !== active) setActive(idx);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      scrollToIndex(idx); // hard-snap to the centered row
      if (options[idx] !== value) onChange(options[idx]);
    }, 120);
  };

  return (
    <div className="relative" style={{ height: VISIBLE * ITEM_H }}>
      {/* selection band */}
      <div
        className="pointer-events-none absolute inset-x-1 top-1/2 z-0 -translate-y-1/2 rounded-lg bg-surface-2"
        style={{ height: ITEM_H }}
      />
      {/* top/bottom fade */}
      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          background:
            "linear-gradient(var(--surface) 0%, transparent 40%, transparent 60%, var(--surface) 100%)",
        }}
      />
      <div
        ref={ref}
        onScroll={onScroll}
        role="listbox"
        aria-label={ariaLabel}
        className="no-scrollbar relative z-10 h-full overflow-y-scroll"
        style={{ paddingTop: PAD, paddingBottom: PAD }}
      >
        {options.map((o, i) => (
          <button
            key={String(o)}
            type="button"
            onClick={() => {
              scrollToIndex(i, true);
              onChange(o);
            }}
            className="flex w-full items-center justify-center"
            style={{ height: ITEM_H }}
          >
            <span
              className={cn(
                // colors only - transitioning font-size reflowed on every
                // scroll tick and made the wheel feel laggy.
                "tabular-nums transition-colors duration-150",
                i === active
                  ? "text-title3 font-semibold text-foreground"
                  : "text-callout text-faint",
              )}
            >
              {o}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
