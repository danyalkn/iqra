import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AndroidImportance, IosAuthorizationStatus, PermissionStatus } from "expo-notifications";
import { Platform } from "react-native";

import { PREF_KEYS, pushEnabledKey, readPref, writePref } from "@/storage/prefs";
import { supabase } from "@/supabase/client";

/**
 * Push registration for this device (docs/PHASE3.md "Subscription rows").
 *
 * Replaces the web's service-worker subscription (reference/web-pwa/push.ts)
 * with an Expo push token. One `push_subscriptions` row per user per token:
 *   { expo: "ExponentPushToken[...]", platform: "ios" | "android", device }
 * The web rows carry an `endpoint` key instead, and the table's generated
 * `endpoint` column (unique) is NULL for ours, so the web's
 * `upsert({ onConflict: "endpoint" })` cannot dedupe Expo rows: this module
 * dedupes by `subscription->>'expo'` itself. No schema change.
 *
 * Lives outside src/lib (react-native, expo modules). Every exported call is
 * safe to fire and forget: it never throws, it returns the resulting state.
 */

export type PushState = "unsupported" | "denied" | "off" | "on";

/** Android channel every Iqra push is sent on (`channelId` in the Expo
 *  message). Created before the permission prompt: Android 13 shows no
 *  prompt until a channel exists, and before the token request as the docs
 *  require. MAX importance mirrors the web's `urgency: high` so reminders
 *  wake the device. */
export const CHANNEL_ID = "iqra";

type Perms = Notifications.NotificationPermissionsStatus;

function isGranted(p: Perms): boolean {
  if (Platform.OS === "ios" && p.ios) {
    // The root `status` can read "undetermined" for a provisional grant;
    // judge iOS by its own authorization status (PHASE3.md).
    const s = p.ios.status;
    return (
      s === IosAuthorizationStatus.AUTHORIZED ||
      s === IosAuthorizationStatus.PROVISIONAL
    );
  }
  return p.granted || p.status === PermissionStatus.GRANTED;
}

function isDenied(p: Perms): boolean {
  if (Platform.OS === "ios" && p.ios) {
    return p.ios.status === IosAuthorizationStatus.DENIED;
  }
  // Android 13+: a refused prompt that cannot be shown again. Older Android
  // has no runtime permission and always reads granted.
  return p.status === PermissionStatus.DENIED && !p.canAskAgain;
}

/** Whether the OS currently lets Iqra show notifications. Reads only, never
 *  prompts (local notifications such as the revision nudge must not ask). */
export async function notificationsAllowed(): Promise<boolean> {
  try {
    return isGranted(await Notifications.getPermissionsAsync());
  } catch {
    return false;
  }
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Iqra",
      importance: AndroidImportance.MAX,
      sound: "default",
      enableVibrate: true,
    });
  } catch (e) {
    console.warn("Notification channel setup failed", e);
  }
}

function projectId(): string | undefined {
  // Set by EAS Build; the fallback covers a dev client started from `expo start`.
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** The Expo push token for this install. A network call to Expo's servers,
 *  retried once (the docs recommend try/catch with a retry). */
async function fetchToken(): Promise<string | null> {
  const id = projectId();
  const attempt = async () => (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  try {
    return await attempt();
  } catch (first) {
    try {
      await new Promise((r) => setTimeout(r, 1500));
      return await attempt();
    } catch (second) {
      console.warn("Expo push token request failed", first, second);
      return null;
    }
  }
}

/** Delete this user's row for one token. Best-effort; RLS scopes it to the
 *  caller, so it is a no-op once signed out (hence sign-out calls it first). */
async function deleteRow(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("subscription->>expo", token);
  // supabase-js returns errors, it does not throw; a failed delete must
  // not read as success (the row would outlive the sign-out).
  if (error) throw error;
}

/** Insert the row for `token` unless this user already has one (dedupe by
 *  the token, see the header). Throws on a request error so the toggle can
 *  show it. */
async function saveRow(userId: string, token: string): Promise<void> {
  const existing = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("subscription->>expo", token)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data?.length ?? 0) > 0) return;
  const { error } = await supabase.from("push_subscriptions").insert({
    user_id: userId,
    subscription: {
      expo: token,
      platform: Platform.OS,
      device: Device.modelName ?? Platform.OS,
    },
  });
  if (error) throw error;
}

/**
 * What the Settings switch and DayReminders show. Local knowledge only (the
 * web read the service-worker subscription, never the table), so it answers
 * fast and offline: "on" means this user enabled push here, the OS still
 * allows it and a token was registered. The launch self-heal keeps the row
 * in step with that answer.
 */
export async function getPushState(userId: string): Promise<PushState> {
  if (!Device.isDevice) return "unsupported";
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (isDenied(perms)) return "denied";
    if (!isGranted(perms)) return "off";
    const [flag, token] = await Promise.all([
      readPref(pushEnabledKey(userId)),
      readPref(PREF_KEYS.pushToken),
    ]);
    return flag === "1" && token ? "on" : "off";
  } catch (e) {
    console.warn("Push state check failed", e);
    return "off";
  }
}

/**
 * Turn push on for this user on this device. `prompt: false` (the launch
 * self-heal) never shows the permission dialog: it only re-registers when the
 * OS already allows notifications, as the web's syncPushSubscription did
 * after FCM rotated a subscription. Returns the resulting state, or throws
 * only for a Supabase error the caller should show.
 */
export async function registerPush(
  userId: string,
  { prompt = true }: { prompt?: boolean } = {},
): Promise<PushState> {
  if (!Device.isDevice) return "unsupported";
  await ensureChannel();
  let perms = await Notifications.getPermissionsAsync();
  if (!isGranted(perms)) {
    if (!prompt) return isDenied(perms) ? "denied" : "off";
    perms = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    if (!isGranted(perms)) return isDenied(perms) ? "denied" : "off";
  }
  const token = await fetchToken();
  if (!token) {
    if (prompt) throw new Error("Couldn’t reach the notification service. Try again.");
    return "off";
  }
  // Token rotation: the row for the previous token is dead, drop it.
  const previous = await readPref(PREF_KEYS.pushToken);
  if (previous && previous !== token) {
    await deleteRow(userId, previous).catch(() => {});
  }
  await saveRow(userId, token);
  await Promise.all([
    writePref(PREF_KEYS.pushToken, token),
    writePref(pushEnabledKey(userId), "1"),
  ]);
  return "on";
}

/**
 * Turn push off for this user on this device: delete the row and forget the
 * registration. Used by the Settings switch (clears the enabled flag too) and
 * by sign-out (`keepFlag`: the row goes, but signing back in re-registers
 * silently, since the member never asked for push to stop).
 */
export async function unregisterPush(
  userId: string,
  { keepFlag = false }: { keepFlag?: boolean } = {},
): Promise<PushState> {
  const token = await readPref(PREF_KEYS.pushToken);
  let deleted = true;
  if (token) {
    try {
      await deleteRow(userId, token);
    } catch (e) {
      // Keep the token pref so the next toggle-on or sign-in (token rotation
      // check) tries the delete again; the enabled flag still clears so the
      // switch reads "off" as asked.
      deleted = false;
      console.warn("Push row delete failed", e);
    }
  }
  await Promise.all([
    deleted ? writePref(PREF_KEYS.pushToken, null) : Promise.resolve(),
    keepFlag ? Promise.resolve() : writePref(pushEnabledKey(userId), null),
  ]);
  return "off";
}

/**
 * Launch / sign-in self-heal (web: syncPushSubscription). No-op unless this
 * user enabled push on this device and the OS still allows it; then the
 * token is fetched again and the row re-asserted, which covers a rotated
 * token, a row pruned after a DeviceNotRegistered ticket, and a reinstall
 * that kept AsyncStorage. Never prompts, never throws.
 */
export async function syncPush(userId: string): Promise<void> {
  try {
    if ((await readPref(pushEnabledKey(userId))) !== "1") return;
    await registerPush(userId, { prompt: false });
  } catch (e) {
    console.warn("Push sync failed", e);
  }
}
