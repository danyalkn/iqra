"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/** Bottom sheet with backdrop, spring slide-up, Escape-to-close, scroll lock.
 *  Constrained to the app's mobile column on larger screens. */
export function Sheet({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [render, setRender] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setRender(false), 260);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!render) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [render, onClose]);

  if (!mounted || !render) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-300",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-[28px] bg-canvas shadow-e3",
          "transition-transform duration-300 ease-spring [will-change:transform]",
          "max-h-[92dvh] overflow-y-auto",
          "pb-[max(1.75rem,env(safe-area-inset-bottom))]",
          shown ? "translate-y-0" : "translate-y-full",
        )}
      >
        <div className="mx-auto mt-3 mb-1 h-1.5 w-10 rounded-full bg-border" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
