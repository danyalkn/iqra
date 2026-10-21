import { useMemo } from "react";

import { useSession } from "@/providers/SessionProvider";

import type { FocusContext } from "./controls";

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Who Focus is for right now, with the profile's zone and mode (the same
 *  fallbacks Today uses). Null while signed out. */
export function useFocusContext(): FocusContext | null {
  const { user, profile } = useSession();
  const userId = user?.id ?? null;
  const tz = profile?.timezone || deviceTimeZone();
  const mode = profile?.mode ?? "reading";
  return useMemo(() => (userId ? { userId, tz, mode } : null), [userId, tz, mode]);
}
