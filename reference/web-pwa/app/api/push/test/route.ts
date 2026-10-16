import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/keys";

/**
 * Sends a test push to the signed-in user's own devices via the send-push
 * edge function (which requires the service-role key, so browsers can't call
 * it directly). Splits the debugging space in half: if the test arrives,
 * delivery works and the problem is upstream (reminder scheduling, mentions);
 * if it doesn't, it's the subscription or the device's OS settings.
 */
// Per-user cooldown. Every test spends an edge-function call and a push signed
// with the project-wide VAPID key, so an unthrottled loop could get that key
// rate-limited by FCM and degrade delivery for everyone. In-memory is enough:
// this is a single-machine deploy, and the cap only needs to stop a loop.
const COOLDOWN_MS = 30_000;
const lastTest = new Map<string, number>();

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const now = Date.now();
  const previous = lastTest.get(user.id);
  if (previous && now - previous < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - previous)) / 1000);
    return NextResponse.json(
      { error: `Just sent one. Try again in ${wait}s.` },
      { status: 429 },
    );
  }
  lastTest.set(user.id, now);
  if (lastTest.size > 500) {
    for (const [id, at] of lastTest) {
      if (now - at > COOLDOWN_MS) lastTest.delete(id);
    }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      user_ids: [user.id],
      payload: {
        title: "Iqra test 🔔",
        body: "Push notifications are working on this account.",
        url: "/settings",
        tag: "test",
      },
    }),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `send-push returned ${res.status}` },
      { status: 502 },
    );
  }

  const result = await res.json();
  return NextResponse.json(result);
}
