import * as Notifications from "expo-notifications";
import { DEFAULT_ACTION_IDENTIFIER } from "expo-notifications";
import { Platform } from "react-native";

import { markEntriesChanged } from "@/data/entryWrites";
import { logContext } from "@/data/logContext";
import { setAfterHifzSync, syncOutbox } from "@/data/sync";
import { withTimeout } from "@/data/timeout";
import { currentStreak, localDate } from "@/lib/dates";
import { toNativeHref } from "@/lib/deepLinks";
import { ENTRY_META, isReadingType, TYPES_BY_MODE, type EntryType } from "@/lib/entries";
import { continuedEntry, parseLogAmount } from "@/lib/entryDefaults";
import { DEFAULT_MUSHAF } from "@/lib/mushaf";
import type { OutboxItem } from "@/lib/outbox";
import { pagesPhrase } from "@/lib/position";
import type { NewEntry } from "@/lib/types";
import { uuidv4 } from "@/lib/uuid";
import { enqueue, loadOutbox } from "@/storage/outbox";
import { PREF_KEYS, readPref, writePref } from "@/storage/prefs";
import { readStoredSession } from "@/supabase/client";

import { ACTION } from "./categories";
import { CHANNEL_ID } from "./register";
import { refreshRevisionNudges } from "./revisionNudge";

/**
 * What a notification response asks for, and the one-tap log it performs.
 * Shared by PushController (both platforms; it also runs iOS background
 * taps) and the Android background task (src/push/task.ts), so a button
 * means the same thing wherever it is handled.
 */

// A synced hifz entry can change tonight's revision nudge. Set here, in the
// module the app entry loads first (index.js -> task.ts -> here), so every
// sync, headless or not, has it.
setAfterHifzSync(refreshRevisionNudges);

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

/** How long a tap waits for its entry to reach the server before saying it
 *  will sync later (a background launch has seconds before suspension). */
const SEND_WAIT_MS = 8000;

/**
 * Log the entry a button stands for, with the sheet's defaults for
 * everything the button did not say (continuation from the last entry of
 * that type, the member's mushaf, now), then confirm with a local
 * notification. The entry goes through the outbox like one from the sheet
 * (docs/NEXT-SESSION.md "Notification buttons offline"): queued with its own
 * id and sent at once, so a send cut off by a suspension or a dead network
 * is retried later into the same primary key, never written twice. Landed:
 * "Logged 5 pages. Streak: 12 days." Still queued: "Saved. It will sync
 * when you're back online." Only an entry that cannot be built (nothing
 * loaded on this device yet, or not signed in) fails, and its notification
 * opens the sheet prefilled.
 */
export async function performLog(
  action: { type: EntryType; amount: number | null; reminderId: string | null; uid: string | null },
  responseKey: string,
  tappedAt: string,
): Promise<LogOutcome> {
  if (inFlight.has(responseKey)) return "duplicate";
  inFlight.add(responseKey);
  try {
    return await performLogClaimed(action, responseKey, tappedAt);
  } finally {
    inFlight.delete(responseKey);
  }
}

async function performLogClaimed(
  action: { type: EntryType; amount: number | null; reminderId: string | null; uid: string | null },
  responseId: string,
  tappedAt: string,
): Promise<LogOutcome> {
  if (!(await claim(responseId))) return "duplicate";
  const retryHref = sheetHref(action.type, action.amount, action.reminderId);
  let queued = false;
  try {
    // Who is signed in, from the keychain: supabase-js reports no session
    // offline once the access token has expired, and would first spend up
    // to half a minute retrying the refresh.
    const userId = (await readStoredSession())?.user.id;
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
    const ctx = await logContext(userId);
    if (!ctx) throw new Error("profile, circle or recent entries never loaded here");
    const { profile, groupId, recent } = ctx;
    if (!TYPES_BY_MODE[profile.mode].includes(action.type)) {
      throw new Error(`type ${action.type} not offered in ${profile.mode} mode`);
    }
    const mush = profile.mushaf ?? DEFAULT_MUSHAF;
    // Dated at the tap, not when the request lands: iOS can suspend a
    // background launch mid-write and resume it hours later.
    const entry = { ...continuedEntry(action.type, recent, mush, action.amount), logged_at: tappedAt };
    const item: OutboxItem = {
      id: uuidv4(),
      userId,
      groupId,
      entry,
      savedAt: tappedAt,
      attempts: 0,
      state: "pending",
    };
    await enqueue(item);
    queued = true;
    // Today and the revision nudges count it from here on, sent or not.
    markEntriesChanged();

    await withTimeout(syncOutbox(userId), SEND_WAIT_MS);
    const left = (await loadOutbox(userId)).find((i) => i.id === item.id);

    const tz = profile.timezone || "UTC";
    const days = new Set(recent.map((e) => localDate(e.logged_at, tz)));
    days.add(localDate(tappedAt, tz));
    const streak = currentStreak(days, tz, Date.now());
    if (!left) {
      await notify(
        `Logged ${describe(entry)}. Streak: ${streak} ${streak === 1 ? "day" : "days"}.`,
        "/today",
      );
    } else if (left.state === "rejected") {
      await notify("Couldn’t save that entry. Tap to see why in Iqra.", "/today");
    } else {
      await notify(`Saved ${describe(entry)}. It will sync when you’re back online.`, "/today");
    }
    // A hifz log can change tonight's revision nudge (a revision drops its
    // juz; a Sabak can move the current juz). A landed entry already did
    // this inside the sync; a queued one does it from the saved copies.
    // After the confirmation so it never delays it; never throws.
    if (left && !isReadingType(entry.entry_type)) {
      await refreshRevisionNudges(userId).catch(() => {});
    }
    return "logged";
  } catch (e) {
    console.warn("Log from notification failed", e);
    // Queued means it is safe on the device and will sync: never invite a
    // second entry by calling that a failure.
    if (queued) return "logged";
    await unclaim(responseId);
    await notify("Couldn’t log that. Tap to finish it in Iqra.", retryHref);
    return "failed";
  }
}

/**
 * A log button tapped with the app not on screen: write it headless and
 * answer with a local notification. One path for both platforms: the
 * Android task (src/push/task.ts) and PushController on iOS, where the
 * actions do not open the app and the system wakes or launches it in the
 * background with the response instead.
 *
 * Every branch ends the interaction: the acted-on notification can stay in
 * the shade after a background action (with the text field's spinner still
 * going), so it is dismissed and whatever follows is a fresh local
 * notification. The last response is cleared so a later launch does not
 * replay it into the sheet.
 */
export async function logInBackground(
  response: Notifications.NotificationResponse,
  parsed: Exclude<ParsedResponse, { kind: "open" }>,
): Promise<void> {
  const tappedAt = new Date().toISOString();
  const id = response.notification.request.identifier;
  try {
    if (parsed.kind === "invalidAmount") {
      // No app on screen to show the sheet in: say so, and let the tap
      // finish it there.
      await notify(
        "That didn’t look like a page count. Tap to log it in Iqra.",
        sheetHref(parsed.type, null, parsed.reminderId),
      );
      return;
    }
    const outcome = await performLog(parsed, responseKey(response), tappedAt);
    if (outcome === "signedOut") {
      await notify("Sign in to Iqra to log that.", "/today");
    } else if (outcome === "wrongUser") {
      await notify("That reminder was for another account on this phone.", "/today");
    }
    // "logged" and "failed" have already notified (a queued entry that hit
    // a surprise after queueing stays silent: it will still sync);
    // "duplicate" is silent.
  } finally {
    await Notifications.dismissNotificationAsync(id).catch(() => {});
    await Notifications.clearLastNotificationResponseAsync().catch(() => {});
  }
}
