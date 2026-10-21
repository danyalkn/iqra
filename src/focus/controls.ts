import { localDate, todayLocal } from "@/lib/dates";
import type { Mode } from "@/lib/entries";
import { FOCUS_OFF, focusUnlocked, withLoggedDay, type FocusState } from "@/lib/focus";

import {
  applyShieldLook,
  armSchedule,
  authStatus,
  blockNow,
  clearBlocks,
  clearEverything,
  focusAvailable,
  saveSelection,
  scheduleArmed,
  unblockNow,
} from "./focus";
import { readFocusState, readStoredFocus, writeFocusState } from "./state";

/**
 * What Focus does, in the app's words: turn on after the picker, change
 * apps, pause for today, resume, turn off, and the one that matters most,
 * "an entry was logged, let the apps go" (docs/FOCUS.md § 4).
 *
 * Everything runs one at a time through `serial`: a reconcile started when
 * the app came to the foreground must not read the state, lose the CPU to
 * a notification button's log, and then put a block back over its unlock.
 * Every function here swallows its own errors: Focus must never break
 * logging, and the native calls are best effort by Apple's design.
 */
export type FocusContext = {
  userId: string;
  /** Profile time zone: "today" is the profile's day, as for the streak. */
  tz: string;
  /** Picks the log buttons on the shield's notification. */
  mode: Mode;
};

let chain: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Block or unblock to match the rule. Idempotent; nothing native when
 *  Focus is off or Screen Time access is missing. */
function applyState(state: FocusState, tz: string): void {
  if (!state.enabled || authStatus() !== "approved") return;
  if (focusUnlocked(state, todayLocal(tz))) unblockNow();
  else blockNow();
}

/**
 * Make the phone match the stored state: on every foreground, after
 * midnight, and once a new member signs in. A state stamped with another
 * account is turned off first, shield and all, so nobody inherits a block;
 * so is a schedule still running while the state says off (a pref write
 * that failed mid-enable). Re-registers the daily schedule if iOS has
 * dropped it (a reinstall or an update can), with its mid-day guard
 * freshly computed, and rewrites the shield look every time so a mode
 * change or an iOS update shows on the next shield.
 */
export function reconcileFocus(ctx: FocusContext): Promise<void> {
  return serial(async () => {
    if (!focusAvailable()) return;
    try {
      const stored = await readStoredFocus();
      if (stored && stored.userId !== ctx.userId) {
        if (stored.enabled) clearEverything();
        await writeFocusState(ctx.userId, FOCUS_OFF);
        return;
      }
      const state = await readFocusState(ctx.userId);
      if (!state.enabled) {
        if (scheduleArmed()) clearEverything();
        return;
      }
      if (authStatus() !== "approved") return;
      applyShieldLook(ctx.mode);
      if (!scheduleArmed()) {
        await armSchedule().catch((e) => console.warn("Focus schedule failed", e));
      }
      applyState(state, ctx.tz);
    } catch (e) {
      console.warn("Focus reconcile failed", e);
    }
  });
}

/**
 * An entry dated `loggedAt` exists (queued on this phone, written by a
 * notification button, or loaded on Today). Today's date in the profile
 * zone unlocks at once; yesterday's (a backdated entry) changes nothing.
 * Unlock on enqueue, not on sync: logging never needs a connection and
 * neither does the shield (decision 3).
 */
export function noteLogged(ctx: FocusContext, loggedAt: string): Promise<void> {
  return serial(async () => {
    if (!focusAvailable()) return;
    try {
      // Another member's state is reconcile's to clear, never to overwrite
      // (a notification button's log can run before the first reconcile).
      const stored = await readStoredFocus();
      if (stored && stored.userId !== ctx.userId) return;
      const state = await readFocusState(ctx.userId);
      const next = withLoggedDay(state, localDate(loggedAt, ctx.tz));
      if (next !== state) await writeFocusState(ctx.userId, next);
      // Applied even when the day was already known: the monitor can
      // re-block after an early log (iOS runs the midnight callback when
      // the phone is next used), and a second log must still open the apps.
      applyState(next, ctx.tz);
    } catch (e) {
      console.warn("Focus unlock failed", e);
    }
  });
}

/**
 * Today's list for today is empty after a read that landed (or from the
 * saved copy): whatever this phone noted for today is gone, deleted here
 * or on another device, so the block comes back at once (owner,
 * 2026-10-21: Focus follows what Today shows, in both directions). A no-op
 * unless the noted day is today or later.
 */
export function forgetToday(ctx: FocusContext): Promise<void> {
  return serial(async () => {
    if (!focusAvailable()) return;
    try {
      const stored = await readStoredFocus();
      if (stored && stored.userId !== ctx.userId) return;
      const state = await readFocusState(ctx.userId);
      if (!state.lastLoggedDay || state.lastLoggedDay < todayLocal(ctx.tz)) return;
      const next = { ...state, lastLoggedDay: null };
      await writeFocusState(ctx.userId, next);
      applyState(next, ctx.tz);
    } catch (e) {
      console.warn("Focus re-block failed", e);
    }
  });
}

/** After the picker closed with something picked: save the apps, store the
 *  shield's look, register the midnight schedule and block or unblock for
 *  today. Rejects when Screen Time refuses the schedule, with Focus left
 *  off, so the card can say so. */
export function enableFocus(ctx: FocusContext, selection: string): Promise<void> {
  return serial(async () => {
    saveSelection(selection);
    applyShieldLook(ctx.mode);
    await armSchedule();
    const state = { ...(await readFocusState(ctx.userId)), enabled: true };
    await writeFocusState(ctx.userId, state);
    applyState(state, ctx.tz);
  });
}

/** A new selection from "Change apps". Blocking only ever adds to the
 *  block list, so the old one is dropped first; the rule then decides. */
export function changeSelection(ctx: FocusContext, selection: string): Promise<void> {
  return serial(async () => {
    try {
      saveSelection(selection);
      clearBlocks();
      applyState(await readFocusState(ctx.userId), ctx.tz);
    } catch (e) {
      console.warn("Focus selection change failed", e);
    }
  });
}

/** "Pause until tomorrow": unlocked for the rest of the profile's day.
 *  Always available, never counted (decision 5). The midnight schedule
 *  brings the block back by itself. */
export function pauseFocus(ctx: FocusContext): Promise<void> {
  return serial(async () => {
    try {
      const state = { ...(await readFocusState(ctx.userId)), pausedDay: todayLocal(ctx.tz) };
      await writeFocusState(ctx.userId, state);
      applyState(state, ctx.tz);
    } catch (e) {
      console.warn("Focus pause failed", e);
    }
  });
}

export function resumeFocus(ctx: FocusContext): Promise<void> {
  return serial(async () => {
    try {
      const state = { ...(await readFocusState(ctx.userId)), pausedDay: null };
      await writeFocusState(ctx.userId, state);
      applyState(state, ctx.tz);
    } catch (e) {
      console.warn("Focus resume failed", e);
    }
  });
}

/** Off: schedule, shield, selection and look all cleared at once; the
 *  logged day is kept so turning it back on today does not block a day
 *  that was already logged. */
export function disableFocus(ctx: FocusContext): Promise<void> {
  return serial(async () => {
    try {
      clearEverything();
      const state = { ...(await readFocusState(ctx.userId)), enabled: false, pausedDay: null };
      await writeFocusState(ctx.userId, state);
    } catch (e) {
      console.warn("Focus turn-off failed", e);
    }
  });
}
