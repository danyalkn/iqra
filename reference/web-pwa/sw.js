/* Iqra service worker - Web Push + notification handling.
 *
 * Deliberately minimal on caching: we do NOT cache API/data responses, to
 * avoid ever serving stale or cross-user data. (An optional offline app-shell
 * can be layered in later.) The job here is to receive push events while the
 * app is closed and to focus/open the app on notification click. */

self.addEventListener("install", () => {
  // Activate this SW immediately on first install / update.
  self.skipWaiting();
});

// VAPID public key, passed on the registration URL (sw.js?vk=…) so the
// pushsubscriptionchange handler can resubscribe even when the browser
// doesn't hand us the old subscription's options.
const VAPID_KEY = new URL(self.location.href).searchParams.get("vk") || "";

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/* Chrome on Android rotates/expires FCM subscriptions (browser updates,
 * token rotation, storage pressure) far more often than Apple's push
 * service does. Without this handler the device silently stops receiving
 * pushes until the user re-toggles notifications - the exact "worked for a
 * while, then stopped" failure. Resubscribe and swap the row server-side. */
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
  const key =
    (event.oldSubscription && event.oldSubscription.options &&
      event.oldSubscription.options.applicationServerKey) ||
    (VAPID_KEY ? urlBase64ToUint8Array(VAPID_KEY) : null);
  if (!key) return;

  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((sub) =>
        fetch("/api/push/resubscribe", {
          method: "POST",
          // The route authenticates via the session cookie.
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldEndpoint, subscription: sub.toJSON() }),
        }),
      )
      .catch(() => {
        // Next app launch re-syncs via syncPushSubscription().
      }),
  );
});

self.addEventListener("activate", (event) => {
  // Take control of open clients without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Iqra", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Iqra";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    // Collapse same-kind notifications (e.g. daily reminders). One-time day
    // reminders carry a per-row tag on purpose so two the same evening stack.
    tag: payload.tag,
    // Without renotify, Android replaces a same-tag notification SILENTLY -
    // yesterday's reminder still in the tray mutes today's entirely.
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/" },
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing window if the app is already open.
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(targetUrl);
            return;
          }
        }
        // Otherwise open a new window.
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      }),
  );
});
