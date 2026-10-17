// Iqra - send-push Edge Function
// Fans a notification out to one or more users. Called by the pg_cron jobs
// (reminders, nudges, recap) and the messages trigger via pg_net,
// authenticated with the project's service-role key.
//
// Two kinds of push_subscriptions rows live side by side (docs/PHASE3.md):
//   web  { endpoint, keys }        -> Web Push with VAPID (the PWA, unchanged)
//   expo { expo, platform, device } -> Expo push service (the native app)
// Dead subscriptions are pruned: web 404/410, Expo DeviceNotRegistered.
//
// Deploy:  supabase functions deploy send-push
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com
//          EXPO_ACCESS_TOKEN=… only if "enhanced push security" is on for the Expo project.
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

type Payload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** Interactive notification category (logReading / logHifz); native only. */
  category?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXPO_ACCESS_TOKEN = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts up to 100 messages per request.
const EXPO_BATCH = 100;
// Must match the channel the app creates (src/push/register.ts).
const EXPO_CHANNEL = "iqra";

// Rows are user-writable (RLS only constrains who owns the row, not what the
// endpoint is), so the sender is where we decide what we're willing to POST to.
// Without this, an account could store an arbitrary https endpoint and use this
// function as an outbound relay. Covers every mainstream push service: FCM
// (Chrome, Edge-Chromium on Android, Samsung Internet, Brave, Opera), WNS
// (Edge on Windows), Mozilla autopush, and Apple.
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "notify.windows.com",
  "push.services.mozilla.com",
  "push.apple.com",
];

function isPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== "string") return false;
  try {
    const { protocol, hostname } = new URL(endpoint);
    if (protocol !== "https:") return false;
    return PUSH_HOST_SUFFIXES.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

/** An Expo push token as the app stores it; anything else is not sent to
 *  Expo (the same "we decide where we POST" rule as the web allowlist). */
function isExpoToken(token: unknown): token is string {
  return typeof token === "string" &&
    /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token);
}

/** Run tasks with a concurrency cap so one big batch can't exhaust the isolate
 *  mid-flight and abort sends for everyone else in the same invocation. */
async function pooled<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await run(item);
      }
    },
  );
  await Promise.all(workers);
}

// Only server-to-server callers (cron / triggers) may fan out notifications.
// The function's verify_jwt gateway already validates the token's signature, so
// trusting its decoded `role` claim is safe. We accept an exact service-role
// key match (fast path) or any validly-signed service_role JWT.
function isAuthorized(header: string | null): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  if (token === SERVICE_ROLE) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

type SubRow = {
  id: string;
  subscription: { endpoint?: unknown; expo?: unknown };
};
type SendError = { host: string; status: number | null; message: string };

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One POST to Expo for up to 100 tokens, retried once on 429 / 5xx / a
 *  network failure. Returns the tickets in message order, or null when the
 *  request itself failed (already recorded in `errors`). */
async function postExpo(
  messages: Record<string, unknown>[],
  errors: SendError[],
): Promise<ExpoTicket[] | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  };
  if (EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${EXPO_ACCESS_TOKEN}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 0) {
          await sleep(1500);
          continue;
        }
        errors.push({
          host: "exp.host",
          status: res.status,
          message: (await res.text()).slice(0, 200),
        });
        return null;
      }
      const json = await res.json() as {
        data?: ExpoTicket[];
        errors?: { code?: string; message?: string }[];
      };
      if (!res.ok || !Array.isArray(json.data)) {
        // Request-level failure (malformed body, bad access token).
        const first = json.errors?.[0];
        errors.push({
          host: "exp.host",
          status: res.status,
          message: first ? `${first.code ?? "error"}: ${first.message ?? ""}` : "no tickets",
        });
        console.error("send-push Expo request failed", res.status, json.errors);
        return null;
      }
      return json.data;
    } catch (err) {
      if (attempt === 0) {
        await sleep(1500);
        continue;
      }
      errors.push({ host: "exp.host", status: null, message: String(err) });
      console.error("send-push Expo request threw", err);
      return null;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!isAuthorized(req.headers.get("Authorization"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let userIds: string[] = [];
  let payload: Payload;
  try {
    const body = await req.json();
    userIds = Array.isArray(body.user_ids) ? body.user_ids : [];
    payload = body.payload;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (userIds.length === 0 || !payload?.title) {
    return Response.json({ sent: 0, removed: 0 });
  }

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, subscription")
    .in("user_id", userIds);

  let sent = 0;
  let removed = 0;
  const errors: SendError[] = [];

  // Partition: web rows keep the path the PWA has always used; expo rows go
  // to Expo's service; anything else is logged and skipped.
  const webRows: SubRow[] = [];
  const expoRows: { id: string; token: string }[] = [];
  for (const row of (subs ?? []) as SubRow[]) {
    if (isExpoToken(row.subscription?.expo)) {
      expoRows.push({ id: row.id, token: row.subscription.expo });
    } else if (row.subscription && "endpoint" in row.subscription) {
      webRows.push(row);
    } else {
      errors.push({
        host: "unrecognised",
        status: null,
        message: "Subscription is neither a web endpoint nor an Expo token - skipped.",
      });
      console.error("send-push skipped an unrecognised subscription row");
    }
  }

  // ── Web Push (unchanged) ───────────────────────────────────────────────
  await pooled(webRows, 20, async (row) => {
    const endpoint = row.subscription?.endpoint;
    if (!isPushEndpoint(endpoint)) {
      errors.push({
        host: "unrecognised",
        status: null,
        message: "Endpoint is not a known push service - skipped.",
      });
      console.error("send-push refused a non-push endpoint");
      return;
    }
    try {
      await webpush.sendNotification(
        row.subscription as webpush.PushSubscription,
        JSON.stringify(payload),
        // high urgency → FCM wakes the device out of Doze for prompt delivery
        // even when the app is fully closed; TTL keeps it for a day if offline.
        { urgency: "high", TTL: 60 * 60 * 24 },
      );
      sent++;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      const code = e?.statusCode ?? null;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", row.id);
        removed++;
        return;
      }
      // Anything else (FCM 400/403 = malformed request / VAPID key mismatch,
      // 429 = rate limit, 5xx) used to vanish silently - exactly the class of
      // failure that makes one platform "just not get notifications".
      let host = "unknown";
      try {
        host = new URL(endpoint as string).host;
      } catch {}
      errors.push({ host, status: code, message: e?.message ?? String(err) });
      console.error(`send-push failed (${host}, status ${code}):`, e?.message);
    }
  });

  // ── Expo push (native) ────────────────────────────────────────────────
  // One message shape for every row; Expo routes to APNs / FCM itself.
  // `data` is what the app reads on tap (url) and in the foreground handler
  // (tag); `collapseId` replaces a displayed notification with the same tag
  // (chat-<group>, reminder), as the PWA's service worker collapsed by tag;
  // `categoryId` turns a reminder into one with log buttons.
  const message = (to: string): Record<string, unknown> => ({
    to,
    title: payload.title,
    body: payload.body,
    data: { url: payload.url ?? "/today", tag: payload.tag ?? null },
    sound: "default",
    channelId: EXPO_CHANNEL,
    priority: "high",
    ...(payload.tag ? { collapseId: payload.tag } : {}),
    ...(payload.category ? { categoryId: payload.category } : {}),
  });

  for (let i = 0; i < expoRows.length; i += EXPO_BATCH) {
    const batch = expoRows.slice(i, i + EXPO_BATCH);
    const tickets = await postExpo(batch.map((r) => message(r.token)), errors);
    if (!tickets) continue;
    // Tickets come back in message order.
    for (let j = 0; j < batch.length; j++) {
      const ticket = tickets[j];
      if (!ticket) {
        errors.push({ host: "exp.host", status: null, message: "Missing ticket." });
        continue;
      }
      if (ticket.status === "ok") {
        sent++;
        continue;
      }
      const code = ticket.details?.error;
      if (code === "DeviceNotRegistered") {
        // The app was uninstalled or notifications revoked: the web's 404/410.
        await supabase.from("push_subscriptions").delete().eq("id", batch[j].id);
        removed++;
        continue;
      }
      errors.push({
        host: "exp.host",
        status: null,
        message: `${code ?? "error"}: ${ticket.message ?? ""}`,
      });
      console.error("send-push Expo ticket error", code, ticket.message);
    }
  }
  // Receipts (/--/api/v2/push/getReceipts, 15 minutes later) are not read:
  // for a five-person circle the tickets plus DeviceNotRegistered pruning
  // are enough (docs/PHASE3.md).

  return Response.json({ sent, removed, errors });
});
