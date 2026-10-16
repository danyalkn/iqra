"use client";

import { useEffect, useState } from "react";

/** Resolved design tokens for recharts, which paints via SVG attributes that
 *  can't read CSS variables - re-read whenever the color scheme flips.
 *  chart1..3 are the validated ordinal green ramp for Sabak → Sabak Para →
 *  Dhor (see globals.css); in light mode chart1 is darkest, in dark mode it
 *  is lightest, so Sabak always carries the most emphasis. */
export type ChartColors = {
  accent: string;
  grid: string;
  tick: string;
  surface: string;
  surface2: string;
  chart1: string;
  chart2: string;
  chart3: string;
};

const LIGHT: ChartColors = {
  accent: "#157f43",
  grid: "#e7e2d8",
  tick: "#9a958c",
  surface: "#ffffff",
  surface2: "#f3f0e9",
  chart1: "#157f43",
  chart2: "#3d9c65",
  chart3: "#66bd8b",
};

export function useChartColors(): ChartColors {
  const [c, setC] = useState<ChartColors>(LIGHT);
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const g = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
      setC({
        accent: g("--accent", LIGHT.accent),
        grid: g("--border", LIGHT.grid),
        tick: g("--faint", LIGHT.tick),
        surface: g("--surface", LIGHT.surface),
        surface2: g("--surface-2", LIGHT.surface2),
        chart1: g("--chart-1", LIGHT.chart1),
        chart2: g("--chart-2", LIGHT.chart2),
        chart3: g("--chart-3", LIGHT.chart3),
      });
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      mq.removeEventListener("change", read);
      obs.disconnect();
    };
  }, []);
  return c;
}

/** The one tooltip style every chart on the page uses: value first. */
export function TooltipCard({
  active,
  label,
  value,
  suffix,
  detail,
}: {
  active?: boolean;
  label?: string;
  value?: number | string;
  suffix?: string;
  /** Optional second line under the value. */
  detail?: string;
}) {
  if (!active) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-e2">
      <p className="text-subhead font-semibold tabular-nums">
        {value}
        {suffix ? ` ${suffix}` : ""}
      </p>
      {detail && <p className="text-caption text-muted">{detail}</p>}
      <p className="text-caption text-faint">{label}</p>
    </div>
  );
}
