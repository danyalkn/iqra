import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

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
 * Platform split, decided in PHASE3.md: Android runs a background task for
 * an action tap, so its buttons do not open the app and the entry is written
 * headless. iOS has no documented headless path for an action, so every iOS
 * action opens the app straight into the log sheet prefilled with the type
 * and amount, where Save is the only tap left.
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

const opensApp = Platform.OS === "ios";

export async function registerCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CATEGORY.reading, [
      {
        identifier: ACTION.pages1,
        buttonTitle: "Log 1 page",
        options: { opensAppToForeground: opensApp },
      },
      {
        identifier: ACTION.pages5,
        buttonTitle: "Log 5 pages",
        options: { opensAppToForeground: opensApp },
      },
      {
        identifier: ACTION.pagesOther,
        buttonTitle: "Other amount",
        textInput: { placeholder: "Pages", submitButtonTitle: "Log" },
        options: { opensAppToForeground: opensApp },
      },
    ]);
    // Android shows at most three buttons; these are the three hifz types.
    // Dismissing the notification is "not today".
    await Notifications.setNotificationCategoryAsync(CATEGORY.hifz, [
      { identifier: ACTION.sabak, buttonTitle: "Sabak", options: { opensAppToForeground: opensApp } },
      {
        identifier: ACTION.sabakPara,
        buttonTitle: "Sabak Para",
        options: { opensAppToForeground: opensApp },
      },
      { identifier: ACTION.dhor, buttonTitle: "Dhor", options: { opensAppToForeground: opensApp } },
    ]);
  } catch (e) {
    console.warn("Notification categories failed to register", e);
  }
}
