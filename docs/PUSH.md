# Push notifications - native design

## Today (web)

- Browser subscribes via service worker (`reference/web-pwa/sw.js`,
  `reference/web-pwa/push.ts`), stores the Web Push subscription JSON in
  `push_subscriptions.subscription` (jsonb, one row per device).
- Postgres `send_push(target uuid[], payload jsonb)` POSTs to the
  `send-push` edge function via pg_net with the service role key. Every
  cron job and trigger (reminders, day reminders, chat, mentions, nudges,
  lapse, streak grace, recap) calls `send_push`.
- `send-push` (`supabase/functions/send-push/index.ts`) loads rows for the
  user ids, sends Web Push with VAPID, prunes 404/410.
- Payload shape: `{ title, body, url?, tag? }`. `url` is an in-app path
  like `/today?log=sabak&r=<uuid>`, `/chat`, `/stats#recap`.

## Target (native + web coexisting)

Keep `send_push` and every SQL job untouched. All change is in the edge
function and the client.

### Client

- `expo-notifications` + `expo-device`. Request permission from the
  Settings toggle (same place as today). Get the **Expo push token**
  (`getExpoPushTokenAsync({ projectId })`), not the raw device token.
- Upsert a row in `push_subscriptions` for this user with
  `subscription = { "expo": "ExponentPushToken[...]", "platform": "ios"|"android", "device": "<model>" }`.
  Keyed per user per token; delete the row on sign-out and when the toggle
  turns off. No schema change needed because the column is jsonb and the
  web rows have an `endpoint` key instead.
- Android: create a notification channel ("Iqra") with high importance so
  reminders wake the device, mirroring the `urgency: high` the web used.
- Response listener: on tap, read `data.url` and `router.push` the native
  route. `/stats#recap` becomes `/stats?section=recap`.
- Foreground: show the banner for everything except chat messages while
  the chat screen is focused.

### Edge function

In `send-push`, after loading rows, split:

```
web rows  (subscription.endpoint)  -> existing web-push path, unchanged
expo rows (subscription.expo)      -> POST https://exp.host/--/api/v2/push/send
                                      Authorization: Bearer EXPO_ACCESS_TOKEN
                                      body: [{ to, title, body, data: { url }, sound: "default",
                                               channelId: "iqra", priority: "high",
                                               ...(tag ? { collapseId: tag } : {}) }]
```

- Batch up to 100 per request. Read the tickets; a ticket with
  `details.error === "DeviceNotRegistered"` means delete that row
  (equivalent of web 404/410).
- Keep the `errors` array in the response so failures stay visible in the
  function logs, as the web version insisted on.
- Secret: `supabase secrets set EXPO_ACCESS_TOKEN=...` (owner task).
- Expo's service handles APNs and FCM credentials; EAS uploads them when
  you build. Nothing APNs-specific lives in this repo.

### Account deletion

`reference/web-pwa/app/api/account/route.ts` used the service role from a
Next API route. Replace with edge function `delete-account`: verify the
caller JWT, `auth.admin.deleteUser(uid)`, cascades do the rest. Client
calls it with the user's access token, then signs out locally.

### Testing

Real devices only. Checklist, same as the web one:

- Toggle on, confirm a row appears with an `expo` key.
- Send a chat message from another account; confirm push and deep link.
- Set a one-time reminder for +5 min; confirm it lands within a minute.
- Turn the toggle off; confirm the row is gone.
- Kill the app, repeat the chat test (background delivery).

### Retirement

When every PWA user has moved: delete rows with an `endpoint` key, remove
the web-push import and VAPID secrets, delete `reference/web-pwa/sw.js`
from the reference folder if it confuses anyone.
