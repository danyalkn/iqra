import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { logInBackground, parseResponse } from "./actions";

/**
 * Android background task for notification actions (docs/PHASE3.md
 * "Without opening the app"). The SDK 58 docs: "Only on Android, the task
 * also runs in response to a notification action tap when the app is
 * backgrounded or terminated." So a tap on "Log 5 pages" with Iqra closed
 * writes the entry here, headless, and the confirmation is a local
 * notification. iOS gets the same write through PushController (the system
 * wakes the app in the background with the response; see categories.ts).
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
    const parsed = parseResponse(data);
    // A body tap opens the app; PushController routes it.
    if (parsed.kind === "open") return Notifications.BackgroundNotificationTaskResult.NoData;
    await logInBackground(data, parsed);
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
