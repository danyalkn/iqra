import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { parseResponse, performLog } from "./actions";

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
    // Taps and invalid amounts open the app; PushController routes them.
    if (parsed.kind !== "log") return Notifications.BackgroundNotificationTaskResult.NoData;
    const id = response.notification.request.identifier;
    const outcome = await performLog(parsed, id);
    if (outcome === "logged" || outcome === "duplicate") {
      // The acted-on notification stays in the shade after a background
      // action; the confirmation replaces it.
      await Notifications.dismissNotificationAsync(id).catch(() => {});
      // So a later launch does not replay this response into the sheet.
      await Notifications.clearLastNotificationResponseAsync().catch(() => {});
    }
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
