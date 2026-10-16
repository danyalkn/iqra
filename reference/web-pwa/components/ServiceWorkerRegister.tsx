"use client";

import { useEffect } from "react";
import { VAPID_PUBLIC_KEY, syncPushSubscription } from "@/lib/push";

/** Registers the push/offline service worker once on the client, then runs
 *  the push-subscription self-heal (see syncPushSubscription). The VAPID key
 *  rides on the SW URL so its pushsubscriptionchange handler can resubscribe
 *  without the page's help. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const url = VAPID_PUBLIC_KEY
      ? `/sw.js?vk=${encodeURIComponent(VAPID_PUBLIC_KEY)}`
      : "/sw.js";
    navigator.serviceWorker
      .register(url)
      .then(() => syncPushSubscription())
      .catch((err) => console.error("SW registration failed:", err));
  }, []);
  return null;
}
