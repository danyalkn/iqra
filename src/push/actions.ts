import * as Notifications from "expo-notifications";
import { DEFAULT_ACTION_IDENTIFIER } from "expo-notifications";
import { Platform } from "react-native";

import { insertEntry, markEntriesChanged } from "@/data/entryWrites";
import type { Profile } from "@/lib/auth";
import { getMyMembership, getMyRecentEntries } from "@/lib/data";
import { currentStreak, localDate } from "@/lib/dates";
import { toNativeHref } from "@/lib/deepLinks";
import { ENTRY_META, isReadingType, TYPES_BY_MODE, type EntryType } from "@/lib/entries";
import { continuedEntry, parseLogAmount } from "@/lib/entryDefaults";
import { DEFAULT_MUSHAF } from "@/lib/mushaf";
import { pagesPhrase } from "@/lib/position";
import type { NewEntry } from "@/lib/types";
import { PREF_KEYS, readPref, writePref } from "@/storage/prefs";
import { supabase } from "@/supabase/client";

import { ACTION } from "./categories";
import { CHANNEL_ID } from "./register";

/**
 * What a notification response asks for, and the one-tap log it performs.
 * Shared by PushController (foreground, both platforms) and the Android
 * background task (src/push/task.ts), so a button means the same thing
 * wherever it is handled.
 */

export type ParsedResponse =
  /** A tap on the body (or an action we do not know): go to `href`. */
  | { kind: "open"; href: string | null }
  /** A log button: write this type, with this many pages (null = the
   *  sheet's default for the type). `reminderId` keys Today's once-only
   *  deep-link consumption. */
  | { kind: "log"; type: EntryType; amount: number | null; reminderId: string | null }
  /** "Other amount" with text that is not a page count: open the sheet. */
  | { kind: "invalidAmount"; type: EntryType; reminderId: string | null };

function urlParam(url: string | null, key: string): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  if (q === -1) return null;
  const m = new RegExp(`(?:^|&)${key}=([^&#]*)`).exec(url.slice(q + 1));
  return m ? decodeURIComponent(m[1]) : null;
}

export function parseResponse(response: Notifications.NotificationResponse): ParsedResponse {
  const data = response.notification.request.content.data;
  const url = typeof data?.url === "string" ? data.url : null;
  const href = toNativeHref(url);
  const action = response.actionIdentifier;
  if (!action || action === DEFAULT_ACTION_IDENTIFIER) return { kind: "open", href };

  const reminderId = urlParam(url, "r");
  // The reading buttons log the type the reminder was for when it is a
  // reading type (`/today?log=revising`), else plain reading.
  const urlType = urlParam(url, "log") as EntryType | null;
  const readingType: EntryType =
    urlType && urlType in ENTRY_META && isReadingType(urlType) ? urlType : "reading";

  switch (action) {
    case ACTION.pages1:
      return { kind: "log", type: readingType, amount: 1, reminderId };
    case ACTION.pages5:
      return { kind: "log", type: readingType, amount: 5, reminderId };
    case ACTION.pagesOther: {
      const amount = parseLogAmount(response.userText);
      return amount == null
        ? { kind: "invalidAmount", type: readingType, reminderId }
        : { kind: "log", type: readingType, amount, reminderId };
    }
    case ACTION.sabak:
      return { kind: "log", type: "sabak", amount: null, reminderId };
    case ACTION.sabakPara:
      return { kind: "log", type: "sabak_para", amount: null, reminderId };
    case ACTION.dhor:
      return { kind: "log", type: "dor", amount: null, reminderId };
    default:
      return { kind: "open", href };
  }
}

/** The Today href that opens the log sheet prefilled for this action. */
export function sheetHref(
  type: EntryType,
  amount: number | null,
  reminderId: string | null,
): string {
  const params = [`log=${type}`];
  if (amount != null) params.push(`amount=${amount}`);
  if (reminderId) params.push(`r=${encodeURIComponent(reminderId)}`);
  return `/today?${params.join("&")}`;
}

// ── Idempotency ────────────────────────────────────────────────────────────
// The Android task and the foreground listener can both see one response,
// and the cold-start hook re-delivers the last one. Notification request ids
// already logged are kept in a pref (capped) so no path writes twice.

const LOGGED_CAP = 20;

async function loggedIds(): Promise<string[]> {
  try {
    const raw = await readPref(PREF_KEYS.pushLogged);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function wasLogged(id: string): Promise<boolean> {
  return (await loggedIds()).includes(id);
}

/** Claim a response id before writing. False when another path already has. */
async function claim(id: string): Promise<boolean> {
  const ids = await loggedIds();
  if (ids.includes(id)) return false;
  ids.push(id);
  await writePref(PREF_KEYS.pushLogged, JSON.stringify(ids.slice(-LOGGED_CAP)));
  return true;
}

async function unclaim(id: string): Promise<void> {
  const ids = await loggedIds();
  await writePref(PREF_KEYS.pushLogged, JSON.stringify(ids.filter((x) => x !== id)));
}

// ── The write ──────────────────────────────────────────────────────────────

export type LogOutcome = "logged" | "duplicate" | "signedOut" | "failed";

async function notify(body: string, url: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: "Iqra", body, data: { url, tag: "log-confirm" }, sound: false },
      // Immediate. Android needs the channel the app created.
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  } catch (e) {
    console.warn("Confirmation notification failed", e);
  }
}

function describe(entry: NewEntry): string {
  if (isReadingType(entry.entry_type)) return pagesPhrase(entry.amount ?? 0);
  const label = ENTRY_META[entry.entry_type].label;
  return entry.juz != null ? `${label}, Juz ${entry.juz}` : label;
}

/**
 * Write the entry a log button stands for, with the sheet's defaults for
 * everything the button did not say (continuation from the last entry of
 * that type, the member's mushaf, now), then confirm with a local
 * notification ("Logged 5 pages. Streak: 12 days."). A headless run has no
 * UI for errors, so a failure is also a notification whose tap opens the
 * sheet prefilled; no retry queue (PHASE3.md: five people, keep it simple).
 */
export async function performLog(
  action: { type: EntryType; amount: number | null; reminderId: string | null },
  responseId: string,
): Promise<LogOutcome> {
  if (!(await claim(responseId))) return "duplicate";
  const retryHref = sheetHref(action.type, action.amount, action.reminderId);
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user.id;
    if (!userId) {
      await unclaim(responseId);
      return "signedOut";
    }
    const [profileRes, membership] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      getMyMembership(supabase),
    ]);
    const profile = (profileRes.data as Profile | null) ?? null;
    if (!profile || !membership) throw new Error("profile or circle unavailable");
    if (!TYPES_BY_MODE[profile.mode].includes(action.type)) {
      throw new Error(`type ${action.type} not offered in ${profile.mode} mode`);
    }
    const mush = profile.mushaf ?? DEFAULT_MUSHAF;
    const recent = await getMyRecentEntries(supabase, membership.group_id, userId);
    const entry = continuedEntry(action.type, recent, mush, action.amount);
    const { row, error } = await insertEntry(userId, membership.group_id, entry);
    if (error || !row) throw new Error(error ?? "insert failed");
    markEntriesChanged();

    const tz = profile.timezone || "UTC";
    const days = new Set(recent.map((e) => localDate(e.logged_at, tz)));
    days.add(localDate(row.logged_at, tz));
    const streak = currentStreak(days, tz, Date.now());
    await notify(
      `Logged ${describe(entry)}. Streak: ${streak} ${streak === 1 ? "day" : "days"}.`,
      "/today",
    );
    return "logged";
  } catch (e) {
    console.warn("Log from notification failed", e);
    await unclaim(responseId);
    await notify("Couldn’t log that. Tap to finish it in Iqra.", retryHref);
    return "failed";
  }
}
