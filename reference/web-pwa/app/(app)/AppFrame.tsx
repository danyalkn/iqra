"use client";

import { useEffect, useState } from "react";
import { TabBar } from "@/components/ui/TabBar";
import { UpdateChecker } from "@/components/UpdateChecker";

/**
 * Authenticated app shell that keeps content above the on-screen keyboard.
 *
 * iOS Safari does NOT shrink the layout viewport when the keyboard opens - only
 * the *visual* viewport shrinks. So we keep the frame full-height (`fixed
 * inset-0`) and pad the bottom by exactly the keyboard overlap, measured as
 * `innerHeight − visualViewport.height − offsetTop`. Content then lays out in
 * the space above the keyboard with no gap and no page-yank. The document is
 * locked so iOS can't scroll the page out from under us. Works the same on
 * Android (visual viewport also shrinks).
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const [kb, setKb] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    // Lock the document so the keyboard can't scroll the page.
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";

    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const overlap = Math.max(
          0,
          window.innerHeight - vv.height - vv.offsetTop,
        );
        setKb(overlap);
      });
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      html.style.overflow = prevOverflow;
    };
  }, []);

  // Only a real soft keyboard pushes the overlap this high (laptops stay at 0).
  const keyboardOpen = kb > 150;

  return (
    <div
      className="fixed inset-0 mx-auto flex w-full max-w-md flex-col pt-[env(safe-area-inset-top)]"
      style={{ paddingBottom: kb }}
    >
      <UpdateChecker />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {/* Hide the tab bar while typing so the chat fills the space above the
          keyboard. Only happens on devices with a soft keyboard. */}
      {!keyboardOpen && <TabBar />}
    </div>
  );
}
