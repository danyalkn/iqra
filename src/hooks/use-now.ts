import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Wall clock as state, so day-derived values (today, date labels, "logged
 * today", cooldown countdowns) recompute after local midnight while a tab
 * stays mounted. The React Compiler memoizes a bare `todayLocal(tz)` on `tz`
 * alone, and NativeTabs keeps every tab mounted for the whole session, so a
 * resident tab would otherwise think it is yesterday until restart (the web
 * had no compiler and remounted the page on every navigation).
 *
 * Ticks on the minute, on foreground return (JS timers sleep in the
 * background) and on tab focus. Pass `everyMs` for a faster tick while
 * something is counting down (Feed's nudge cooldown ticks once a second);
 * the default is minute-aligned.
 */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          arm();
        },
        everyMs - (Date.now() % everyMs) + 50,
      );
    };
    arm();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [everyMs]);
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  return now;
}
