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
const lib: typeof DeviceActivity | null =
  Platform.OS === "ios"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- a static import would run the package's Android stub at launch
      (require("react-native-device-activity") as typeof DeviceActivity)
    : null;

/** The member's picked apps, kept in the App Group by the library under
 *  this id so the extensions can read them. */
export const SELECTION_ID = "iqra-focus";
/** The shield look and buttons, stored under this id. */
export const SHIELD_ID = "iqra-focus-shield";
/** The daily schedule. The library only applies a shield to a selection
 *  whose id is contained in a monitored activity's name (README "Some
 *  Notes"), so this must contain SELECTION_ID. */
export const ACTIVITY = "iqra-focus";

/** Screen Time exists on this build: iOS 15+ with the native module. False
 *  on Android. True on the simulator, where authorization never completes
 *  and the picker is empty, so this feature is tested on a phone only. */
export function focusAvailable(): boolean {
  return !!lib && lib.isAvailable();
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
    await lib.requestAuthorization("individual");
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

/** What the blocked app shows (owner's wording, 2026-10-21). Title and
 *  subtitle keep the system label colour so they read in dark mode too. */
function shieldLook(): DeviceActivity.ShieldConfiguration {
  return {
    title: "Iqra",
    subtitle: "Log today's Quran in Iqra to unlock this app.",
    iconSystemName: "book.closed.fill",
    iconTint: ACCENT,
    primaryButtonLabel: "Open Iqra",
    primaryButtonBackgroundColor: ACCENT,
    primaryButtonLabelColor: WHITE,
    secondaryButtonLabel: "Not now",
    backgroundBlurStyle: lib?.UIBlurEffectStyle.systemMaterial,
  };
}

/**
 * The shield's buttons. "Open Iqra" tries to open the app (the library
 * opens `device-activity://`, a scheme app.json registers; Apple does not
 * promise a shield can open apps) and posts a local notification with the
 * member's log buttons, so the entry can be made from the banner without
 * opening Iqra at all (src/push/categories.ts, PushController writes it
 * headless and the unlock follows). `userInfo.url` is read by
 * src/push/actions.ts as the notification's `data.url`. Hifz members get
 * their own buttons. "Not now" just closes.
 */
function shieldButtons(mode: Mode): DeviceActivity.ShieldActions {
  const hifz = mode === "hifz";
  return {
    primary: {
      behavior: "close",
      actions: [
        { type: "openApp" },
        {
          type: "sendNotification",
          payload: {
            title: "Iqra",
            body: "Log today's Quran to unlock your apps.",
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
 * Store the shield under its id (what the midnight action applies by
 * `shieldId`) AND as the library's default (what a block made from the app
 * shows: `blockSelection` called from JS never copies the id-keyed look,
 * only the extension's action does, Shared.swift `updateShield`).
 */
export function applyShieldLook(mode: Mode): void {
  if (!lib) return;
  const look = shieldLook();
  const buttons = shieldButtons(mode);
  lib.updateShieldWithId(look, buttons, SHIELD_ID);
  lib.updateShield(look, buttons, "iqra");
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

/** Anything shielded at all, from the ManagedSettings store itself. */
export function shieldActive(): boolean {
  return !!lib && lib.isShieldActive();
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
