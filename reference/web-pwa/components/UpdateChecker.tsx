"use client";

import { useEffect } from "react";
import { BUILD } from "@/lib/build";

/**
 * Auto-reload when a newer build is deployed. The running bundle has BUILD baked
 * in; /api/version reports the live server's BUILD. On load and whenever the app
 * returns to the foreground, we compare - a mismatch means a new deploy is live,
 * so we reload to pick it up. Essential for iOS standalone PWAs, which otherwise
 * resume the stale in-memory bundle forever.
 */
export function UpdateChecker() {
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { build } = await r.json();
        if (!stopped && build && build !== BUILD) location.reload();
      } catch {
        /* offline / transient - ignore */
      }
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return null;
}
