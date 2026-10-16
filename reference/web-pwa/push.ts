import { createClient } from "@/lib/supabase/client";

export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export type PushState =
  | "unsupported"
  | "needs-install" // iOS Safari, not added to Home Screen
  | "denied"
  | "off"
  | "on";

function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // iOS only exposes Push once installed to the Home Screen.
    if (isIOS() && !isStandalone()) return "needs-install";
    return "unsupported";
  }
  if (isIOS() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";

  // Don't hang on serviceWorker.ready if the SW isn't active yet.
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
  ]);
  if (!reg) return "off";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Marks that a given user turned push ON for this device, so the launch-time
 *  re-sync knows it may silently resubscribe after the push service rotates
 *  the subscription (frequent on Android/FCM, rare on Apple's service).
 *  Keyed per user: a browser profile shared by two accounts must not have one
 *  account's registration silently adopted by the other. */
const FLAG_PREFIX = "iqra:push-enabled:";
const flagKey = (userId: string) => `${FLAG_PREFIX}${userId}`;

/** Any other account that has enabled push in this browser profile. */
function otherEnabledUser(userId: string): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(FLAG_PREFIX) && k !== flagKey(userId)) return true;
    }
  } catch {}
  return false;
}

/** Request permission, subscribe, and persist the subscription. Must be called
 *  from a user gesture. Returns the resulting state. */
export async function enablePush(userId: string): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) throw new Error("Missing VAPID public key.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "off";
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });

  const supabase = createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, subscription: sub.toJSON() as unknown as object },
      { onConflict: "endpoint" },
    );
  if (error) throw error;
  try {
    localStorage.setItem(flagKey(userId), "1");
  } catch {}
  return "on";
}

/** Unsubscribe this device and remove its stored subscription. */
export async function disablePush(): Promise<PushState> {
  // The subscription is per browser profile, so turning it off here ends it
  // for every account that had enabled it on this device.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(FLAG_PREFIX)) localStorage.removeItem(k);
    }
  } catch {}
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    const supabase = createClient();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
  return "off";
}

/** Launch-time self-heal. Two Android-realistic failures leave a device that
 *  thinks push is on but never receives anything:
 *   1. FCM rotated/expired the subscription → old endpoint 410s → the edge
 *      function pruned the DB row → nothing re-creates it.
 *   2. The subscription still exists locally but its DB row is gone (prune,
 *      reinstall, account hiccup).
 *  With permission already granted, resubscribing needs no user gesture, so
 *  every launch we re-assert the subscription and re-upsert its row. No-op
 *  unless this user enabled push on this device. */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !VAPID_PUBLIC_KEY ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;

    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    if (!reg) return;

    const userId = session.user.id;
    let sub = await reg.pushManager.getSubscription();

    // Devices that enabled push before the flag existed have none, but do have
    // a live subscription (disablePush always unsubscribes) - adopt those.
    // Never adopt when another account enabled push here: that registration is
    // theirs, and stealing it would send their alerts to this session.
    if (localStorage.getItem(flagKey(userId)) !== "1") {
      if (!sub || otherEnabledUser(userId)) return;
      try {
        localStorage.setItem(flagKey(userId), "1");
      } catch {}
    }

    // Rotate proactively when the browser reports an imminent expiry.
    if (sub?.expirationTime && sub.expirationTime - Date.now() < 24 * 60 * 60 * 1000) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }

    const subscribe = async () =>
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    if (!sub) sub = await subscribe();

    // Upsert is idempotent - cheap insurance against a pruned/missing row.
    const save = (s: PushSubscription) =>
      supabase.from("push_subscriptions").upsert(
        { user_id: userId, subscription: s.toJSON() as unknown as object },
        { onConflict: "endpoint" },
      );

    // supabase-js returns errors, it doesn't throw - check, or a failure here
    // is invisible and the "self-heal" never heals.
    const { error } = await save(sub);
    if (!error) return;

    // 42501: this endpoint's row belongs to a different account (shared browser
    // profile) and RLS blocks the update. Take a fresh endpoint for this user
    // instead of failing silently every launch; the old subscription dies, so
    // the other account's row gets pruned on its next send.
    if (error.code === "42501") {
      await sub.unsubscribe().catch(() => {});
      const fresh = await subscribe();
      const { error: retryError } = await save(fresh);
      if (retryError) console.error("Push re-register failed:", retryError.message);
      return;
    }
    console.error("Push sync failed:", error.message);
  } catch {
    // Best-effort: never block app startup on push housekeeping.
  }
}
