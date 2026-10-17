import * as Notifications from "expo-notifications";

/**
 * Interactive notification categories (docs/PHASE3.md "Interactive
 * notifications"). A reminder push carries `categoryId` = one of these and
 * the OS shows the buttons under it, so a member can log without opening
 * the app. Identifiers avoid ":" and "-" (the SDK 58 docs forbid them).
 *
 * Registered at every launch (categories are per install and the docs do
 * not promise persistence), from the same module scope that sets the
 * notification handler.
 *
 * No action opens the app, on either platform: the point of the buttons
 * is logging without opening Iqra. Android runs the background task in
 * src/push/task.ts. On iOS an action without the foreground option makes
 * the system wake or launch the app in the background and deliver the
 * response, which PushController writes headless (PHASE4.md option A;
 * options B and C there are the fallbacks if the phone loses writes).
 * Either way the only feedback is a local confirmation. A tap
 * while the app is on screen still opens the prefilled sheet.
 */

export const CATEGORY = {
  reading: "logReading",
  hifz: "logHifz",
} as const;

export const ACTION = {
  pages1: "pages1",
  pages5: "pages5",
  pagesOther: "pagesOther",
  sabak: "sabak",
  sabakPara: "sabakPara",
  dhor: "dhor",
} as const;

/** Shared by every action: see the header. */
const inBackground = { opensAppToForeground: false };

export async function registerCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CATEGORY.reading, [
      {
        identifier: ACTION.pages1,
        buttonTitle: "Log 1 page",
        options: inBackground,
      },
      {
        identifier: ACTION.pages5,
        buttonTitle: "Log 5 pages",
        options: inBackground,
      },
      {
        identifier: ACTION.pagesOther,
        buttonTitle: "Other amount",
        textInput: { placeholder: "Pages", submitButtonTitle: "Log" },
        options: inBackground,
      },
    ]);
    // Android shows at most three buttons; these are the three hifz types.
    // Dismissing the notification is "not today".
    await Notifications.setNotificationCategoryAsync(CATEGORY.hifz, [
      { identifier: ACTION.sabak, buttonTitle: "Sabak", options: inBackground },
      {
        identifier: ACTION.sabakPara,
        buttonTitle: "Sabak Para",
        options: inBackground,
      },
      { identifier: ACTION.dhor, buttonTitle: "Dhor", options: inBackground },
    ]);
  } catch (e) {
    console.warn("Notification categories failed to register", e);
  }
}
