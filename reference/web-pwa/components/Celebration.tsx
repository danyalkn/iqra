"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Pref key shared with the settings toggle (device-local, no migration). */
export const CELEBRATE_KEY = "iqra:celebrate";

const MESSAGES = [
  "MashaAllah 📖",
  "May Allah accept it 🤲",
  "Keep going 🌙",
  "Another page closer ✨",
  "BarakAllahu feek 💚",
  "Beautiful work 🎉",
  "One step at a time 🕌",
  "So proud of you 🌟",
];

const COLORS = ["#1b6b53", "#4fb590", "#d9a24a", "#e06a5c", "#5fc8a1", "#f0c674"];

type Piece = {
  left: number;
  w: number;
  h: number;
  color: string;
  dx: number;
  rot: number;
  dur: number;
  delay: number;
};

function makePieces(): Piece[] {
  return Array.from({ length: 46 }, () => ({
    left: Math.random() * 100,
    w: 6 + Math.random() * 6,
    h: 10 + Math.random() * 8,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    dx: (Math.random() - 0.5) * 220,
    rot: 360 + Math.random() * 540,
    dur: 1.6 + Math.random() * 0.9,
    delay: Math.random() * 0.25,
  }));
}

/** Confetti burst + an encouraging word. Plays once whenever `trigger` changes
 *  to a new value. Respects prefers-reduced-motion (skips the confetti). */
export function Celebration({ trigger }: { trigger: number }) {
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState("");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (trigger === 0) return;
    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMsg(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
    setPieces(reduce ? [] : makePieces());
    setActive(true);
    const t = setTimeout(() => setActive(false), 2400);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!mounted || !active) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute top-0 rounded-[1px]"
          style={
            {
              left: `${p.left}%`,
              width: p.w,
              height: p.h,
              background: p.color,
              "--dx": `${p.dx}px`,
              "--rot": `${p.rot}deg`,
              animation: `confettiFall ${p.dur}s linear ${p.delay}s forwards`,
            } as React.CSSProperties
          }
        />
      ))}
      <div className="absolute inset-0 grid place-items-center">
        <div className="animate-[popIn_320ms_var(--ease-spring)] rounded-2xl bg-surface px-6 py-4 text-center shadow-e3">
          <p className="text-title3 font-semibold">{msg}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
