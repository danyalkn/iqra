import { Platform } from "react-native";
import type * as DeviceActivity from "react-native-device-activity";

import type { Mode } from "@/lib/entries";
import type { SelectionCounts } from "@/lib/focus";
import { CATEGORY } from "@/push/categories";

/**
 * Every call into react-native-device-activity (Apple's Screen Time
 * frameworks: FamilyControls, ManagedSettings, DeviceActivity) lives here,
 * so the rest of the app talks about Focus in its own words. docs/FOCUS.md
 * has the design; the library's build/index.d.ts and ios/Shared.swift are
 * the source of truth for what each call does (its README is partly stale).
 *
 * iOS only. The package's Android entry is a stub whose every call warns,
 * and its module scope wraps that stub in an event emitter, so it is loaded
 * on iOS alone and every function here is a no-op elsewhere.
 */
function loadLib(): typeof DeviceActivity | null {
  if (Platform.OS !== "ios") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would run the package's Android stub at launch
    return require("react-native-device-activity") as typeof DeviceActivity;
  } catch (e) {
    // A build without the native module (the TestFlight 1.0.0 build given
    // this JS by an update): Focus simply does not exist there.
    console.warn("Focus unavailable on this build", e);
    return null;
  }
}

const lib = loadLib();

/** The member's picked apps, kept in the App Group by the library under
 *  this id so the extensions can read them. */
export const SELECTION_ID = "iqra-focus";
/** The shield look and buttons, stored under this id. */
export const SHIELD_ID = "iqra-focus-shield";
/** The daily schedule. The library only applies a shield to a selection
 *  whose id is contained in a monitored activity's name (README "Some
 *  Notes"), so this must contain SELECTION_ID. */
export const ACTIVITY = "iqra-focus";

/** iOS major version, 0 elsewhere. */
function iosMajor(): number {
  if (Platform.OS !== "ios") return 0;
  return parseInt(String(Platform.Version), 10) || 0;
}

/** Focus exists on this build: the native module on iOS 18 or later. The
 *  library says iOS 15, but the three extensions are built for iOS 18
 *  (expo-apple-targets' default), and without them there is no shield
 *  look, no buttons and no midnight re-block. False on Android. True on
 *  the simulator, where authorization never completes and the picker is
 *  empty, so this feature is tested on a phone only. */
export function focusAvailable(): boolean {
  return !!lib && lib.isAvailable() && iosMajor() >= 18;
}

export type FocusAuth = "approved" | "denied" | "notDetermined";

function toAuth(status: DeviceActivity.AuthorizationStatusType): FocusAuth {
  if (!lib) return "notDetermined";
  if (status === lib.AuthorizationStatus.approved) return "approved";
  if (status === lib.AuthorizationStatus.denied) return "denied";
  return "notDetermined";
}

/** A change made in iOS Settings is only seen after the app restarts
 *  (README "Weird behaviors"); the Settings card says so. */
export function authStatus(): FocusAuth {
  return lib ? toAuth(lib.getAuthorizationStatus()) : "notDetermined";
}

/** Ask for Screen Time access for the member's own device (`individual`;
 *  never `child`, docs/FOCUS.md decision 1). The system sheet can be shown
 *  again after a refusal, unlike most iOS permissions, so a denied member
 *  can retry from the card. The status lags the sheet, hence the poll. */
export async function requestFocusAuth(): Promise<FocusAuth> {
  if (!lib) return "notDetermined";
  try {
    // Resolves only once access is granted (iOS 16+ throws on a refusal
    // or a dismissal), and the polled status can still say "denied" for
    // a moment after a member who refused earlier now allows it.
    await lib.requestAuthorization("individual");
    return "approved";
  } catch {
    // Refused or dismissed: the polled status says which.
  }
  return toAuth(await lib.pollAuthorizationStatus({ pollIntervalMs: 250, maxAttempts: 20 }));
}

/** The picker's opaque token for the current selection, to prefill
 *  "Change apps"; null when nothing is saved. */
export function savedSelection(): string | null {
  return lib?.getFamilyActivitySelectionId(SELECTION_ID) ?? null;
}

export function saveSelection(familyActivitySelection: string): void {
  lib?.setFamilyActivitySelectionId({ id: SELECTION_ID, familyActivitySelection });
}

/** Counts only: Iqra never learns which apps (decision 7). */
export function selectionCounts(): SelectionCounts | null {
  if (!lib || !savedSelection()) return null;
  try {
    const m = lib.activitySelectionMetadata({ activitySelectionId: SELECTION_ID });
    return m
      ? {
          applicationCount: m.applicationCount,
          categoryCount: m.categoryCount,
          webDomainCount: m.webDomainCount,
        }
      : null;
  } catch {
    return null;
  }
}

/** Paper & Pine accent (#157f43) and white, as the shield wants them. */
const ACCENT = { red: 21, green: 127, blue: 67 };
const WHITE = { red: 255, green: 255, blue: 255 };

/**
 * Whether a shield button can open Iqra. Apple never let a shield action
 * open an app (the library's `openApp` does nothing on a device) until
 * iOS 26.5 added the `openParentalControlsApp` response, which the
 * extension returns for that behavior through
 * patches/react-native-device-activity+0.6.1.patch (upstream PR #97).
 */
function shieldCanOpenApp(): boolean {
  if (Platform.OS !== "ios") return false;
  const [major = 0, minor = 0] = String(Platform.Version).split(".").map(Number);
  return major > 26 || (major === 26 && minor >= 5);
}

/** What the blocked app shows (owner's wording, 2026-10-21). Title and
 *  subtitle keep the system label colour so they read in dark mode too.
 *  Before iOS 26.5 the button can only post a reminder, and says so. */
function shieldLook(canOpen: boolean): DeviceActivity.ShieldConfiguration {
  return {
    title: "Iqra",
    subtitle: "Log some Quran today in Iqra to unlock this app.",
    iconSystemName: "book.closed.fill",
    iconTint: ACCENT,
    primaryButtonLabel: canOpen ? "Open Iqra" : "Remind me",
    primaryButtonBackgroundColor: ACCENT,
    primaryButtonLabelColor: WHITE,
    secondaryButtonLabel: "Not now",
    backgroundBlurStyle: lib?.UIBlurEffectStyle.systemMaterial,
  };
}

/**
 * The shield's buttons. On iOS 26.5+ "Open Iqra" brings Iqra to the front
 * of the shielded app. Earlier, "Remind me" posts a local notification
 * carrying the member's log buttons, so the entry can be made from the
 * banner without opening Iqra at all (src/push/categories.ts;
 * PushController writes it headless and the unlock follows).
 * `userInfo.url` is read by src/push/actions.ts as the notification's
 * `data.url`. Hifz members get their own buttons. "Not now" just closes.
 */
function shieldButtons(mode: Mode, canOpen: boolean): DeviceActivity.ShieldActions {
  if (canOpen) {
    return { primary: { behavior: "openParentalControlsApp" }, secondary: { behavior: "close" } };
  }
  const hifz = mode === "hifz";
  return {
    primary: {
      behavior: "close",
      actions: [
        {
          type: "sendNotification",
          payload: {
            title: "Iqra",
            body: "Log some Quran today to unlock your apps.",
            categoryIdentifier: hifz ? CATEGORY.hifz : CATEGORY.reading,
            userInfo: { url: hifz ? "/today?log=sabak" : "/today?log=reading", tag: "focus" },
            interruptionLevel: "active",
          },
        },
      ],
    },
    secondary: { behavior: "close" },
  };
}

/**
 * Store the shield in the three places the extensions read it from
 * (Shared.swift `getActivitySelectionPrefixedConfigFromUserDefaults`
 * and `updateShield`): under its id, which the midnight action applies by
 * `shieldId`; as the library's default, which a block made from the app
 * shows (`blockSelection` called from JS never copies the id-keyed look);
 * and under the selection, which the midnight action writes and the
 * extensions prefer over the default from then on, so a newer look (a
 * mode change, an iOS update past 26.5) would otherwise wait for the
 * next midnight. Cheap, so it runs on every reconcile.
 */
export function applyShieldLook(mode: Mode): void {
  if (!lib) return;
  const canOpen = shieldCanOpenApp();
  const look = shieldLook(canOpen);
  const buttons = shieldButtons(mode, canOpen);
  lib.updateShieldWithId(look, buttons, SHIELD_ID);
  lib.updateShield(look, buttons, "iqra");
  lib.userDefaultsSet(`shieldConfigurationForSelection_${SELECTION_ID}`, look);
  lib.userDefaultsSet(`shieldActionsForSelection_${SELECTION_ID}`, buttons);
}

/** Device-local midnight after `now`, as the DeviceActivity schedule sees it. */
function nextDeviceMidnight(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d;
}

/**
 * The midnight re-block: a daily schedule whose `intervalDidStart` makes
 * the monitor extension block the selection again, app open or not. The
 * day ends at 23:59 and nothing is configured for `intervalDidEnd`: an
 * unblock there would free the apps for anyone who did not log (FOCUS.md).
 *
 * iOS fires `intervalDidStart` straight away when a schedule is started
 * inside its interval, which would re-block a member who enabled Focus
 * after logging today, so the action sits out until the coming midnight
 * (two minutes early, in case the callback lands a touch before the hour).
 * Re-armed only when the monitor is missing (see `scheduleArmed`), so the
 * guard is fresh each time. Throws when Screen Time refuses (not
 * authorized); callers decide what to show.
 */
export async function armSchedule(): Promise<void> {
  if (!lib) return;
  const guard = new Date(nextDeviceMidnight().getTime() - 2 * 60_000);
  lib.configureActions({
    activityName: ACTIVITY,
    callbackName: "intervalDidStart",
    actions: [
      {
        type: "blockSelection",
        familyActivitySelectionId: SELECTION_ID,
        shieldId: SHIELD_ID,
        neverTriggerBefore: guard,
      },
    ],
  });
  await lib.startMonitoring(
    ACTIVITY,
    {
      intervalStart: { hour: 0, minute: 0 },
      intervalEnd: { hour: 23, minute: 59 },
      repeats: true,
    },
    [],
  );
}

/** True while the daily schedule is registered with iOS. */
export function scheduleArmed(): boolean {
  return !!lib && lib.getActivities().includes(ACTIVITY);
}

/** Shield the selection now (a union with whatever is already blocked, so
 *  repeating it is harmless). */
export function blockNow(): void {
  lib?.blockSelection({ activitySelectionId: SELECTION_ID }, "iqra");
}

/** Drop the selection from the shield now. */
export function unblockNow(): void {
  lib?.unblockSelection({ activitySelectionId: SELECTION_ID }, "iqra");
}

/** Forget the whole block list (the shield comes off). Used before a
 *  changed selection is applied, since blocking only ever adds. */
export function clearBlocks(): void {
  lib?.resetBlocks("iqra");
}

/**
 * Turn everything off: the schedule, the shield, the selection and the
 * stored look, so a later enable starts from a clean picker (FOCUS.md
 * checklist). The Screen Time authorization itself is kept; it is the
 * member's to revoke in Settings.
 */
export function clearEverything(): void {
  if (!lib) return;
  lib.stopMonitoring([ACTIVITY]);
  lib.resetBlocks("iqra");
  lib.cleanUpAfterActivity(ACTIVITY);
  const ids = lib.userDefaultsGet<Record<string, string>>("familyActivitySelectionIds") ?? {};
  if (SELECTION_ID in ids) {
    const rest = { ...ids };
    delete rest[SELECTION_ID];
    lib.userDefaultsSet("familyActivitySelectionIds", rest);
  }
  for (const key of [
    `shieldConfiguration_${SHIELD_ID}`,
    `shieldActions_${SHIELD_ID}`,
    `shieldConfigurationForSelection_${SELECTION_ID}`,
    `shieldActionsForSelection_${SELECTION_ID}`,
    lib.SHIELD_CONFIGURATION_KEY,
    lib.SHIELD_ACTIONS_KEY,
  ]) {
    lib.userDefaultsRemove(key);
  }
}

/** The native picker, presented as an iOS sheet from an invisible anchor
 *  view (README "Native sheet"). Null off iOS. */
export const SelectionSheet = lib?.DeviceActivitySelectionSheetView ?? null;
export type SelectionSheetProps = DeviceActivity.ReactNativeDeviceActivitySheetViewProps;
