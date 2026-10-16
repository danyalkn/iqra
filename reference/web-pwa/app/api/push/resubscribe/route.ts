import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Called by the service worker's `pushsubscriptionchange` handler when the
 * push service rotates this device's subscription (common on Android/FCM).
 *
 * A service-worker `fetch()` is same-origin, so it carries the session cookie
 * and we can act as the signed-in user: the row swap goes through the normal
 * user-scoped client and RLS (`user_id = auth.uid()`) is the ownership check.
 * We deliberately do NOT use the service-role key here - an unauthenticated
 * "possessing the old endpoint is proof enough" route would let anyone who
 * learned a stored endpoint repoint it at their own keys and receive that
 * user's decrypted notifications.
 *
 * If the session has lapsed, we 401 and the app self-heals on next launch via
 * syncPushSubscription(), which always runs with a real session.
 */

/** Host of an https URL, or null. */
function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let oldEndpoint: unknown;
  let subscription: { endpoint?: unknown; keys?: unknown } | null = null;
  try {
    const body = await request.json();
    oldEndpoint = body.oldEndpoint;
    subscription = body.subscription;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const keys = subscription?.keys as
    | { p256dh?: unknown; auth?: unknown }
    | undefined;
  if (
    typeof oldEndpoint !== "string" ||
    typeof subscription?.endpoint !== "string" ||
    typeof keys?.p256dh !== "string" ||
    typeof keys?.auth !== "string"
  ) {
    return NextResponse.json({ updated: false });
  }

  // A rotation stays on the same push service. Comparing hosts instead of
  // checking a hardcoded allowlist keeps every browser working (Chrome,
  // Samsung Internet, Edge, Firefox, Safari all use different hosts) while
  // still refusing to point a subscription at an unrelated server.
  const oldHost = httpsHost(oldEndpoint);
  if (!oldHost || httpsHost(subscription.endpoint) !== oldHost) {
    return NextResponse.json({ updated: false });
  }

  // Swap the subscription on this user's own row for the old endpoint. RLS
  // scopes the update; the extra user_id filter keeps intent explicit.
  const { data, error } = await supabase
    .from("push_subscriptions")
    .update({ subscription })
    .eq("endpoint", oldEndpoint)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    // 23505: the new endpoint already has its own row (the client re-upserted
    // first) - the old row is stale, so just drop it.
    if (error.code === "23505") {
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", oldEndpoint)
        .eq("user_id", user.id);
      return NextResponse.json({ updated: true });
    }
    // Don't echo Postgres text back - an RLS message would reveal whether an
    // endpoint is registered to someone else.
    console.error("Push resubscribe update failed:", error.message);
    return NextResponse.json({ error: "Could not update" }, { status: 500 });
  }

  if ((data?.length ?? 0) > 0) return NextResponse.json({ updated: true });

  // No row matched: the send-push pruner already deleted it after the old
  // endpoint 410'd. That is the *common* rotation ordering, so registering the
  // new subscription here is what actually keeps the device alive - otherwise
  // it stays silent until the user happens to open the app. This grants no
  // extra capability: RLS already lets this same authenticated user write
  // their own subscription row directly.
  const { error: insertError } = await supabase
    .from("push_subscriptions")
    .upsert({ user_id: user.id, subscription }, { onConflict: "endpoint" });
  if (insertError) {
    console.error("Push resubscribe insert failed:", insertError.message);
    return NextResponse.json({ error: "Could not register" }, { status: 500 });
  }
  return NextResponse.json({ updated: true });
}
