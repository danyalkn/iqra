import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import { Platform } from "react-native";

import { fetchMyHifzHistory } from "@/data/entryReads";
import { todayLocal } from "@/lib/dates";
import { ENTRY_META, type Mode } from "@/lib/entries";
import { dueAhead, revisionPlan, type RevisionItem } from "@/lib/revisionPlan";
import { pushEnabledKey, readPref, readRevisionHidden } from "@/storage/prefs";
import { supabase } from "@/supabase/client";

import { CHANNEL_ID, notificationsAllowed } from "./register";

/**
 * The evening revision nudge (docs/DECISIONS.md "Revision plan"): one local
 * notification at 20:00 device time listing the juz still due that day and
 * not hidden. Scheduled on the device a week ahead from the plan's
 * projection, and rescheduled whenever Today's plan changes, so a revision
 * logged today drops it from tonight's list (or cancels tonight's nudge
 * outright when nothing is left).
 *
 * Only for hifz members who turned notifications on here (the per-user
 * push-enabled flag) while the OS still allows them; this never asks for the
 * permission. No buttons and no category: a one-tap log could pick the
 * wrong juz, so the tap just opens Today. Cancelled whenever the signed-in
 * member changes (sign-out, an expired session) and when the Settings switch
 * turns notifications off.
 *
 * Kept current from three places: Today (useRevisionNudges.ts, from the entries
 * on screen), a log written headless from a notification button
 * (refreshRevisionNudges at the end of performLog), and every return to the
 * foreground (refreshRevisionNudges from PushController), which picks up
 * revisions logged on the web or another phone. Accepted gap: a revision
 * made elsewhere while this app stays closed all day leaves that evening's
 * nudge in place, since nothing on this device runs to cancel it.
 */

/** Every revision nudge's identifier starts with this, then the local date. */
export const REVISION_ID_PREFIX = "revision-";

/** Device-local hour the nudge fires at. */
export const NUDGE_HOUR = 20;

/** Today plus the next six days. */
const DAYS_AHEAD = 7;

export type RevisionSlot = { day: string; juz: { juz: number; type: RevisionItem["type"] }[] };

async function cancelAll(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter((n) => n.identifier.startsWith(REVISION_ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch (e) {
    console.warn("Revision nudge cancel failed", e);
  }
}

/** 20:00 on that calendar date, device time. The plan's dates are
 *  profile-local; the owner asked for device time, and the two only differ
 *  for someone travelling. */
function fireDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, NUDGE_HOUR, 0, 0, 0);
}

/** Plain meaning first, the hifz word in brackets (no bare jargon). */
const MEANING: Record<RevisionItem["type"], string> = {
  sabak_para: "a recent revision",
  dor: "an old review",
};

function juzList(juz: number[]): string {
  const names = juz.map((n) => `Juz ${n}`);
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A suggestion, not an order (owner, 2026-10-17), one sentence per type in
 *  plan order: "Juz 3 and Juz 2 could use a recent revision (Sabak Para)
 *  today. Skip it if you have another plan." */
function body(slot: RevisionSlot): string {
  const byType = new Map<RevisionItem["type"], number[]>();
  for (const j of slot.juz) byType.set(j.type, [...(byType.get(j.type) ?? []), j.juz]);
  const lines = [...byType].map(
    ([type, juz]) =>
      `${juzList(juz)} could use ${MEANING[type]} (${ENTRY_META[type].label}) today.`,
  );
  return `${lines.join(" ")} Skip it if you have another plan.`;
}

async function schedule(userId: string, slots: RevisionSlot[]): Promise<void> {
  const [flag, allowed] = await Promise.all([
    readPref(pushEnabledKey(userId)),
    notificationsAllowed(),
  ]);
  // Always start clean: a day that is no longer due must lose its nudge.
  await cancelAll();
  if (flag !== "1" || !allowed) return;
  const now = Date.now();
  for (const slot of slots) {
    if (slot.juz.length === 0) continue;
    const date = fireDate(slot.day);
    if (date.getTime() <= now) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `${REVISION_ID_PREFIX}${slot.day}`,
        content: {
          title: "Revision suggestion",
          body: body(slot),
          // uid: PushController follows a tap only for the member it was for.
          data: { url: "/today", tag: "revision", uid: userId },
          sound: "default",
        },
        trigger: {
          type: SchedulableTriggerInputTypes.DATE,
          date,
          // Android shows local notifications on the channel the app made.
          ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
        },
      });
    } catch (e) {
      console.warn("Revision nudge schedule failed", slot.day, e);
    }
  }
}

// Runs one at a time, in call order, so an older run can never finish after
// a newer one and leave its days behind (or reschedule after a sign-out).
let queue: Promise<void> = Promise.resolve();
function enqueue(job: () => Promise<void>): Promise<void> {
  queue = queue.then(job, job).catch(() => {});
  return queue;
}

/** Replace the scheduled nudges with these days (queued; never throws). */
export function scheduleRevisionSlots(userId: string, slots: RevisionSlot[]): Promise<void> {
  return enqueue(() => schedule(userId, slots));
}

/** Cancel every scheduled revision nudge (sign-out, push switched off, not
 *  in hifz mode). Queued behind any reschedule in flight. Never throws. */
export function cancelRevisionNudges(): Promise<void> {
  return enqueue(cancelAll);
}

/** The week ahead: what each day will have due if nothing more is logged,
 *  minus the juz hidden today (today's slot only; hidden rows come back
 *  tomorrow). */
export function revisionSlots(plan: RevisionItem[], today: string, hiddenToday: number[]): RevisionSlot[] {
  return dueAhead(plan, today, DAYS_AHEAD).map(({ day, due }) => ({
    day,
    juz: due
      .filter((i) => day !== today || !hiddenToday.includes(i.juz))
      .map((i) => ({ juz: i.juz, type: i.type })),
  }));
}

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Reschedule from the server, without Today: the member's mode and
 * timezone, the whole hifz history and today's hidden rows. For a log
 * written headless from a notification button and for a return to the
 * foreground. A failed read leaves the schedule as it is (never wipes it);
 * a member no longer in hifz mode loses the nudges. Never throws.
 */
export async function refreshRevisionNudges(userId: string): Promise<void> {
  try {
    const [profileRes, history] = await Promise.all([
      supabase.from("profiles").select("mode, timezone").eq("id", userId).maybeSingle(),
      fetchMyHifzHistory(userId),
    ]);
    if (profileRes.error || !profileRes.data) return;
    const { mode, timezone } = profileRes.data as { mode: Mode | null; timezone: string | null };
    if (mode !== "hifz") {
      await cancelRevisionNudges();
      return;
    }
    if (history.error || !history.rows) return;
    // Same fallback as Today.
    const tz = timezone || deviceTimeZone();
    const today = todayLocal(tz);
    const hidden = await readRevisionHidden(userId, today);
    const slots = revisionSlots(revisionPlan(history.rows, tz, today), today, hidden);
    await scheduleRevisionSlots(userId, slots);
  } catch (e) {
    console.warn("Revision nudge refresh failed", e);
  }
}
