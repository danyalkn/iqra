import * as Notifications from "expo-notifications";
import { DEFAULT_ACTION_IDENTIFIER } from "expo-notifications";
import { Platform } from "react-native";

import { fetchMyRecentEntries } from "@/data/entryReads";
import { insertEntry, markEntriesChanged } from "@/data/entryWrites";
import type { Profile } from "@/lib/auth";
import { getMyMembership } from "@/lib/data";
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
   *  deep-link consumption; `uid` is the member the push was sent to. */
  | {
      kind: "log";
      type: EntryType;
      amount: number | null;
      reminderId: string | null;
      uid: string | null;
    }
  /** "Other amount" with text that is not a page count: open the sheet. */
  | { kind: "invalidAmount"; type: EntryType; reminderId: string | null };

/**
 * A key that is unique per delivered push. The request identifier alone is
 * NOT: a remote push's identifier is its collapse id on iOS and its tag on
 * Android, so every daily reminder would share one ("reminder") and the
 * second one would read as a duplicate of the first. send-push stamps a
 * per-message `sendId`; the delivery time is the fallback for pushes sent
 * before that (two taps on one displayed notification share both).
 */
export function responseKey(response: Notifications.NotificationResponse): string {
  const { request, date } = response.notification;
  const sendId = request.content.data?.sendId;
  if (typeof sendId === "string" && sendId) return sendId;
  return `${request.identifier}@${date}`;
}

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
  const uid = typeof data?.uid === "string" ? data.uid : null;
  // The reading buttons log the type the reminder was for when it is a
  // reading type (`/today?log=revising`), else plain reading.
  const urlType = urlParam(url, "log") as EntryType | null;
  const readingType: EntryType =
    urlType && urlType in ENTRY_META && isReadingType(urlType) ? urlType : "reading";

  switch (action) {
    case ACTION.pages1:
      return { kind: "log", type: readingType, amount: 1, reminderId, uid };
    case ACTION.pages5:
      return { kind: "log", type: readingType, amount: 5, reminderId, uid };
    case ACTION.pagesOther: {
      const amount = parseLogAmount(response.userText);
      return amount == null
        ? { kind: "invalidAmount", type: readingType, reminderId }
        : { kind: "log", type: readingType, amount, reminderId, uid };
    }
    case ACTION.sabak:
      return { kind: "log", type: "sabak", amount: null, reminderId, uid };
    case ACTION.sabakPara:
      return { kind: "log", type: "sabak_para", amount: null, reminderId, uid };
    case ACTION.dhor:
      return { kind: "log", type: "dor", amount: null, reminderId, uid };
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
// the cold-start hook re-delivers the last one, and two quick taps on the
// same notification start two task runs. Response keys already logged are
// kept in a pref (capped); keys being written right now in a module Set,
// checked before the first await so concurrent runs cannot both claim.

const LOGGED_CAP = 20;
const inFlight = new Set<string>();

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

export type LogOutcome = "logged" | "duplicate" | "signedOut" | "wrongUser" | "failed";

/** A local notification, shown at once (the headless path's only UI). */
export async function notify(body: string, url: string): Promise<void> {
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
  action: { type: EntryType; amount: number | null; reminderId: string | null; uid: string | null },
  responseKey: string,
): Promise<LogOutcome> {
  if (inFlight.has(responseKey)) return "duplicate";
  inFlight.add(responseKey);
  try {
    return await performLogClaimed(action, responseKey);
  } finally {
    inFlight.delete(responseKey);
  }
}

async function performLogClaimed(
  action: { type: EntryType; amount: number | null; reminderId: string | null; uid: string | null },
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
    // A push addressed to another member (a row left behind on a shared
    // phone) must never write into this account.
    if (action.uid && action.uid !== userId) {
      await unclaim(responseId);
      return "wrongUser";
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
    // The throwing read: a dead network must fail here, not continue from
    // "nothing logged" and reset the bookmark or restart sabak at Juz 1.
    const { rows: recent, error: readError } = await fetchMyRecentEntries(
      membership.group_id,
      userId,
    );
    if (readError || !recent) throw new Error("recent entries unavailable");
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
