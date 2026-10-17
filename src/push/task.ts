import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { notify, parseResponse, performLog, responseKey, sheetHref } from "./actions";

/**
 * Android background task for notification actions (docs/PHASE3.md
 * "Without opening the app"). The SDK 58 docs: "Only on Android, the task
 * also runs in response to a notification action tap when the app is
 * backgrounded or terminated." So a tap on "Log 5 pages" with Iqra closed
 * writes the entry here, headless, and the confirmation is a local
 * notification. iOS has no such path; its actions open the app instead.
 *
 * Defined at module scope from the app entry (index.js) as the docs
 * require, so a headless launch evaluates it before anything renders.
 * Registration is Android-only: on iOS registerTaskAsync needs the
 * remote-notification background mode, which this app does not want.
 */

export const NOTIFICATION_TASK = "iqra-notification-actions";

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error || !data || !("actionIdentifier" in data)) {
      // A received notification, not a response: nothing to do.
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }
    const response = data;
    const parsed = parseResponse(response);
    // A body tap opens the app; PushController routes it.
    if (parsed.kind === "open") return Notifications.BackgroundNotificationTaskResult.NoData;
    const id = response.notification.request.identifier;
    // Every branch below ends the interaction: the acted-on notification
    // stays in the shade after a background action (with the text field's
    // spinner still going), so it is dismissed and whatever follows is a
    // fresh local notification. The last response is cleared so a later
    // launch does not replay it into the sheet.
    const done = async () => {
      await Notifications.dismissNotificationAsync(id).catch(() => {});
      await Notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    if (parsed.kind === "invalidAmount") {
      // No app to open from here (the action is background-only on
      // Android): say so, and let the tap finish it in the sheet.
      await notify(
        "That didn’t look like a page count. Tap to log it in Iqra.",
        sheetHref(parsed.type, null, parsed.reminderId),
      );
      await done();
      return Notifications.BackgroundNotificationTaskResult.NewData;
    }
    const outcome = await performLog(parsed, responseKey(response));
    if (outcome === "signedOut") {
      await notify("Sign in to Iqra to log that.", "/today");
    } else if (outcome === "wrongUser") {
      await notify("That reminder was for another account on this phone.", "/today");
    }
    // "logged" and "failed" have already notified; "duplicate" is silent.
    await done();
    return Notifications.BackgroundNotificationTaskResult.NewData;
  },
);

export async function registerNotificationTask(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.registerTaskAsync(NOTIFICATION_TASK);
  } catch (e) {
    console.warn("Notification task registration failed", e);
  }
}
