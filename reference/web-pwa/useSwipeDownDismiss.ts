import { useRef } from "react";

/**
 * Touch handlers that blur the focused field (dismissing the soft keyboard)
 * on a deliberate downward swipe. Spread onto a bar the user can drag down -
 * the composer or the tab bar.
 */
export function useSwipeDownDismiss(threshold = 40) {
  const startY = useRef<number | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      startY.current = e.touches[0]?.clientY ?? null;
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (startY.current == null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy > threshold) {
        (document.activeElement as HTMLElement | null)?.blur();
        startY.current = null;
      }
    },
    onTouchEnd: () => {
      startY.current = null;
    },
  };
}
