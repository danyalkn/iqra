import { FOCUS_OFF, type FocusState } from "@/lib/focus";
import { PREF_KEYS, readPref, writePref } from "@/storage/prefs";

/**
 * Where Focus's three facts live: one device-level pref, stamped with the
 * member they belong to (docs/FOCUS.md § 4). Nothing about Focus is ever
 * sent to the server or shown to the circle (decision 6).
 */
type Stored = FocusState & { userId: string };

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { userId, enabled, lastLoggedDay, pausedDay } = v as Record<string, unknown>;
    if (typeof userId !== "string") return null;
    return {
      userId,
      enabled: enabled === true,
      lastLoggedDay: typeof lastLoggedDay === "string" ? lastLoggedDay : null,
      pausedDay: typeof pausedDay === "string" ? pausedDay : null,
    };
  } catch {
    return null;
  }
}

/** The stored state whoever it belongs to; `controls.ts` reconciles a
 *  stamp that is not the signed-in member's. */
export async function readStoredFocus(): Promise<Stored | null> {
  return parse(await readPref(PREF_KEYS.focus));
}

/** This member's state; off when the pref is missing or someone else's. */
export async function readFocusState(userId: string): Promise<FocusState> {
  const stored = await readStoredFocus();
  if (!stored || stored.userId !== userId) return FOCUS_OFF;
  const { enabled, lastLoggedDay, pausedDay } = stored;
  return { enabled, lastLoggedDay, pausedDay };
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** The Settings card re-reads after any write, wherever it came from
 *  (Today's save, a notification button, the midnight timer). */
export function subscribeFocus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function writeFocusState(userId: string, state: FocusState): Promise<void> {
  await writePref(PREF_KEYS.focus, JSON.stringify({ userId, ...state }));
  for (const l of listeners) l();
}
