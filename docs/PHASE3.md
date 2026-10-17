# Phase 3 handoff - push, deep links, account deletion, first TestFlight

Written 2026-10-16 at the end of Phase 2 for the next Claude session and
the owner. Read `CLAUDE.md`, `docs/HANDOFF.md` (Status, working notes) and
`docs/DECISIONS.md` § Notifications first; `docs/PUSH.md` is the original
design and still holds except where this file corrects it. Everything
below was checked against the code, the migrations and the SDK 58 / EAS
docs on 2026-10-16; items marked UNVERIFIED were not.

Phase 3 is **single-threaded**: one agent, one consistent thread of
decisions (push, routing and the edge function all touch the same
contract). Subagents on Sonnet or Opus are fine for research, review and
scoped fixes; the main session owns the decisions.

## State of play

- Phases 0 to 2 are code complete, adversarially reviewed and verified on
  the iOS 26.5 simulator; Phase 2 runs on the owner's phone (EAS dev
  build ff2ff734, Metro on 8082). Device-only checks still open are listed
  in `HANDOFF.md` (haptics, 3 AM window, live traffic from a second device).
- `expo-notifications` is NOT installed; `expo-device` ~58.0.5,
  `expo-constants`, `expo-linking` and `expo-updates` ~58.0.17 are.
  `app.json` has scheme `iqra`, bundle id / package
  `com.qadamtechnologies.iqra`, EAS projectId
  `47441911-3778-4ae5-84f8-c226e9a4860f`, `updates.url` set,
  `runtimeVersion { policy: "appVersion" }`, version `0.1.0`.
- `eas.json`: `appVersionSource: remote`; development and production
  profiles `autoIncrement`; preview (Android APK) does not; `submit.production`
  is empty.
- Stubs waiting for this phase (grep "Phase 3"):
  `src/components/settings/NotificationsToggle.tsx` (disabled switch),
  `src/components/DayReminders.tsx:48` (`getPushState()` always "off"),
  `src/data/account.ts:17` (404 from the missing `delete-account` function
  reads as "not available in this build yet").
- Adding `expo-notifications` is a native change: a dev-client rebuild
  (`npx eas-cli@latest build --profile development --platform ios`) is
  mandatory before any of it runs, and the owner must delete nothing this
  time (builds now auto-increment). JS-only follow-ups ship over Metro.

## Owner tasks (do these first; several are long poles)

1. **App Store Connect app record** under Qadam Technologies Inc.: name
   Iqra, bundle id `com.qadamtechnologies.iqra`, a SKU (e.g. `iqra-ios`),
   primary language English. Copy the numeric Apple ID of the app (App
   Information > General) into `eas.json` as `submit.production.ios.ascAppId`
   together with `appleTeamId`. Also decide the app version for the first
   store build (1.0.0 is conventional; `runtimeVersion` follows it, see EAS
   Update below).
2. **Privacy policy URL** and **a test account** (email + password of a
   member in the circle) for Beta App Review; TestFlight external testing
   needs both. Decide where the policy lives (a page on iqra.fly.dev is
   fine until the PWA retires).
3. ~~**Supabase**: paste the migration, deploy the functions~~ Done
   2026-10-16 from this machine after the owner ran `supabase login`: the
   Phase 3 migration is applied and recorded, `send-push` (v6) and
   `delete-account` (v1) are deployed with JWT verification on (both answer
   401 unauthenticated). A stray June function (slug `smart-api`) that
   nothing called was deleted at the same time.
4. **Expo access token**: only needed if "enhanced push security" is
   switched on for the project on expo.dev (then `supabase secrets set
   EXPO_ACCESS_TOKEN=...`). Check the project's push settings; leave it off
   for now and skip the secret.
5. **APNs key**: EAS already holds one under the org (created on the first
   dev build). Confirm with `npx eas-cli@latest credentials --platform ios`.
6. **Android push credentials (deferred)**: Firebase project, register the
   package, `google-services.json` in the repo + `android.googleServicesFile`,
   FCM V1 service-account key uploaded via `eas credentials`. Not needed for
   the iOS TestFlight; needed before the Android member gets pushes.
7. **First Android build interactively** (`eas build --profile preview
   --platform android`) so EAS creates and stores the keystore; later runs
   can be non-interactive.

## Design, as decided (PUSH.md) with corrections from the research

### Subscription rows

- Row shape (no schema change):
  `{ "expo": "ExponentPushToken[...]", "platform": "ios" | "android", "device": "<Device.modelName>" }`
  in `push_subscriptions.subscription`. RLS policy `push_subscriptions_all`
  already allows the user's own rows; no grant change.
- **Correction:** `push_subscriptions.endpoint` is a generated column from
  `subscription->>'endpoint'` with a UNIQUE index. Expo rows have no
  `endpoint`, so it is NULL and the web's `upsert({ onConflict: "endpoint" })`
  cannot dedupe them (NULLs never conflict). Native dedupes itself:
  `select id where user_id = me and subscription->>'expo' = token`, then
  insert or leave; on toggle-off and before sign-out `delete where
  user_id = me and subscription->>'expo' = token`. Alternative, only if the
  owner wants it: a migration adding a generated `expo_token` column with a
  unique index. Recommended: no migration for this.
- Device prefs (`src/storage/prefs.ts`): `iqra:push-enabled:<userId>` (the
  web's flag; gates a silent re-register on launch, the port of
  `syncPushSubscription`) and `iqra:push-token` (so toggle-off and sign-out
  delete the right row even if the token changed).

### Edge function `send-push`

`supabase/functions/send-push/index.ts` (160 lines, Deno.serve, `npm:web-push@3.6.7`,
`npm:@supabase/supabase-js@2` UNPINNED: pin it). Today a row without
`endpoint` fails the host allowlist and is logged as `host: "unrecognised"`
on every send (harmless, noisy). Change, keeping the web path byte-for-byte:

- Partition rows: `subscription.endpoint` -> web path as today;
  `subscription.expo` -> Expo path; anything else -> skip (log).
- Expo path: POST `https://exp.host/--/api/v2/push/send` with
  `Content-Type: application/json`, `Accept: application/json`, optional
  `Authorization: Bearer ${EXPO_ACCESS_TOKEN}` (only when set). Body: an
  array of up to 100 messages
  `{ to, title, body, data: { url, tag }, sound: "default", channelId: "iqra", priority: "high", ...(tag ? { collapseId: tag } : {}), ...(category ? { categoryId: category } : {}) }`.
  Read the tickets in order: a ticket `{ status: "error", details: { error: "DeviceNotRegistered" } }`
  deletes that row (the web's 404/410 equivalent); other errors go into the
  existing `errors` array. Retry 429 / 5xx once with backoff. Receipts
  (`/--/api/v2/push/getReceipts`, 15 min later) are out of scope for a
  five-person circle; note it.
- Payload gains an optional `category` key (see interactive notifications)
  and keeps `{ title, body, url, tag }`; the SQL callers are unchanged except
  the reminder jobs that add `category`.
- Keep the `{ sent, removed, errors }` response.

### Phase 3 migration (one file, owner pastes it)

`supabase/migrations/2026MMDD120000_phase3_push.sql`:

1. `revoke execute on function public.send_push(uuid[], jsonb) from public, anon, authenticated;`
   (research finding: nothing revoked it, so any client can call it over
   `/rpc` today).
2. Re-create the reminder senders so their payload carries `category`:
   `cron_send_day_reminders` (day_reminders.sql:212) and the personal
   reminders sweep (no_em_dashes.sql:76) add `'category', case when mode = 'hifz' then 'logHifz' else 'logReading' end`
   where mode is the recipient's `profiles.mode` (no `-` or `:` in a
   category id, the docs forbid them); the lapsed nudge and streak-grace jobs the same. Chat,
   nudge and recap pushes get no category. Every other line of those
   functions stays identical (copy the latest definition, which is the
   last migration that defines it, listed in the research: day reminders
   in `20260906120000_day_reminders.sql`, personal reminders and recap in
   `20260829160000_no_em_dashes.sql`, lapsed in
   `20260829150000_nudge_review_fixes.sql`, streak grace in
   `20261004120000_backdate_window.sql`). No em dashes in any copy.
3. Nothing else. No column renames, nothing the web reads changes.

### Client: `src/push/` (outside `src/lib`, it imports react-native)

- `register.ts`: `registerPush(userId)`: on Android create channel `iqra`
  (name "Iqra", `AndroidImportance.MAX`) BEFORE asking permission (Android
  13 shows no prompt otherwise); `getPermissionsAsync` then
  `requestPermissionsAsync({ ios: { allowAlert, allowBadge, allowSound } })`;
  on iOS judge `ios.status` (AUTHORIZED or PROVISIONAL), not the root
  status; `Device.isDevice` guard (simulators get no remote token);
  `getExpoPushTokenAsync({ projectId })` with projectId from
  `Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId`
  (network call: try/catch, retry once); insert the row (dedupe above);
  write the prefs. `unregisterPush(userId)`: delete the row, clear prefs.
  `getPushState()`: `"unsupported" | "denied" | "off" | "on"` for the toggle
  and for `DayReminders`.
- `chatVisibility.ts`: `setChatVisible(bool)` / `isChatVisible()`; Chat's
  screen sets it in `useFocusEffect` (true on focus, false on blur). The
  chat screen already tracks focus and AppState for `markRead`; reuse that
  spot.
- `PushController.tsx`: a headless component mounted in
  `src/app/_layout.tsx` inside `SessionProvider` next to `SplashController`
  (it needs `useSession()` and must outlive route changes). At module
  scope: `Notifications.setNotificationHandler({ handleNotification })`
  returning `{ shouldShowBanner, shouldShowList, shouldPlaySound: false, shouldSetBadge: false }`
  (`shouldShowAlert` is deprecated), all false only when
  `data.tag` starts with `chat-` AND `isChatVisible()` AND AppState is
  active. Decision recorded here: mention and reply pushes also carry a
  `chat-<group>` tag, so they are suppressed with the rest while the chat
  is on screen, which is what "the chat is open" means to a reader; nudges
  (`tag: nudge`) and reminders always show. Keep the handler fast (SDK 58
  shows the notification anyway if it exceeds 3 s).
- Tap routing in the same component: `addNotificationResponseReceivedListener`
  for warm taps and `useLastNotificationResponse()` for the cold start
  (undefined while loading, null if none); read
  `response.notification.request.content.data.url`, map with
  `toNativeHref` (`src/lib/deepLinks.ts`: `/stats#recap` ->
  `/stats?section=recap`), hold it as `pendingHref` until the gate is open
  (`!loading && session && isOnboarded`), then `router.push` and
  `clearLastNotificationResponseAsync()`. Dedupe by
  `response.notification.request.identifier` in a module-level Set (the
  hook re-delivers on remount). This closes the known gap "a cold-start
  deep link while signed out is dropped": the href survives the login
  (keep it in memory; persist with `writePref("iqra:pending-href")` only
  if a kill mid-login matters). Discard it on sign-out or user switch.
  `index.tsx` redirects to `/today` first, so push, never replace.
- Launch self-heal: when `iqra:push-enabled:<userId>` is set and
  permission is still granted, re-run `registerPush` silently (token
  rotation), as the web did in `syncPushSubscription`.
- Settings: `NotificationsToggle` gets the web's states
  (`unsupported | denied | off | on` plus loading / busy / error) and copy
  (on: "You'll get reminders, @mentions, sunset check-ins, and your Sunday
  week-in-review."; denied: point to Settings via `Linking.openSettings()`);
  BellRing + accent tint when on; the web's "Send a test" section does not
  come back. `DayReminders.getPushState` reads the same function.
- Sign-out: `SessionProvider.signOut` calls `unregisterPush` best-effort
  (short timeout, never blocks leaving) BEFORE `supabase.auth.signOut`,
  because RLS blocks the delete afterwards.

### Interactive notifications (owner request 2026-10-16)

Members get lazy about logging; a reminder should let them log from the
notification itself. The exact API and the platform limits are in
"Interactive notifications: facts" below; where this sketch and the facts
disagree, the facts win.

- Two categories registered at every app start (they are per install):
  - `logReading`: actions `pages1` "Log 1 page", `pages5` "Log 5 pages",
    `pagesOther` "Other amount" (text input, placeholder "Pages", submit
    "Log").
  - `logHifz`: actions `sabak` "Sabak", `sabakPara` "Sabak Para", `dhor`
    "Dhor". Android shows at most three buttons, so "Not today" is iOS
    only if kept at all (dismissing does the same).
  Reminder pushes carry `categoryId` = `logReading` / `logHifz` from the
  SQL payload (migration item 2); chat, nudge and recap pushes carry none.
- Handling: in `PushController`, the response listener branches on
  `actionIdentifier`. The default identifier (a tap on the body) routes as
  before. An action identifier writes a `log_entries` row through the same
  path `LogSheet` uses (`src/data/entryWrites.ts` has the update / delete
  writers; add an `insertEntry` there so Today and the notification share
  one insert, including the `mushaf` retry guard), with the amount from
  the button or `userText`, `entry_type` from the category, `from_ref` /
  `to_ref` continued from the member's last entry of that type (the
  "Continue from last page" default), and `logged_at` now. Then a local
  confirmation notification ("Logged 5 pages. Streak: 12 days.") and
  `markEntriesChanged()` so Today refetches. Invalid text ("abc", 0, > 100)
  opens the app on the log sheet instead of writing.
- Creative touches that cost nothing server-side: rotate the reminder body
  copy the server already personalises; a "Same as yesterday" action whose
  amount is the member's last entry of that type (the client knows it);
  on Sunday the recap push gets no actions (it is a read).
- Platform limits decide whether an action can complete without opening
  the app; see the facts section and follow it rather than this sketch.

### Account deletion: edge function `delete-account`

`supabase/functions/delete-account/index.ts`: verify the caller's JWT
(create a client with the request's Authorization header, `auth.getUser()`),
then an admin client (service role, `persistSession: false`) calls
`auth.admin.deleteUser(user.id)`; respond `{ ok: true }` or `{ error }` with
a non-2xx status. Cascades do the rest (verified for profiles,
group_members, log_entries, messages, nudges, push_subscriptions,
reminders, day_reminders, reactions, chat_reads). The client
(`src/data/account.ts`) already invokes it and maps `{ error }`; after the
function is deployed delete the `NOT_AVAILABLE` copy path.

## Progress and decisions made while building (2026-10-16)

Steps 1 to 5 of the order of work are code complete, typechecked and
linted (commits 116220a..c2287ab). Decisions taken by the Phase 3 session
that refine the plan above:

- **Sign-out keeps the per-user enabled flag.** The device row is deleted
  before `auth.signOut` (RLS), but `iqra:push-enabled:<userId>` stays, so
  signing back in re-registers silently; the member asked to leave, not to
  stop notifications. The Settings switch clears the flag.
- **Simulators report `unsupported`** (Expo cannot deliver remote pushes to
  them) and the toggle says so. Local notifications still work there for
  testing the categories.
- **Foreground pushes keep their sound** (`shouldPlaySound: !suppress`)
  because Android drops the heads-up alert without it; iOS gets the same
  for consistency.
- **Categories follow the reminder's entry type first**, then the mode: a
  hifz member's "Reading" reminder shows the reading buttons
  (`push_category(mode, entry_type)` in the migration).
- **The streak-grace nudge carries no category**: it asks for yesterday's
  entry and a one-tap action logs now. It opens Today, where the Yesterday
  control is live until 3 AM.
- **Foreground action taps open the prefilled sheet on both platforms**;
  only Android with the app in the background (or killed) writes headless
  through the task. Response ids already written are kept in the
  `iqra:push-logged` pref (capped) so the task, the listener and the
  cold-start hook never log one tap twice.
- **No retry queue** for a failed headless write: the failure is a local
  notification whose tap opens the sheet prefilled (five people).
- **"Other amount" accepts 0 < n <= 100** with up to two decimals (the
  sheet's own rule), not the 1 to 604 range sketched above.
- **Shared lib addition**: `src/lib/entryDefaults.ts` (pure) now owns the
  fresh-entry defaults and the row constructors LogSheet used inline, so
  the notification actions save exactly what the sheet would. Native-first;
  the web keeps the rules inline until it adopts the file.
- **Dedupe key is per delivered push, not the request identifier.** The
  OS reuses the identifier across pushes with one collapse id / tag (every
  daily reminder is "reminder"), so send-push stamps `data.sendId` per
  message and the app falls back to `identifier@date`. Found in review.
- **A push names its recipient** (`data.uid`); the app refuses to log for
  another account, and the migration's `push_subscriptions_claim_token`
  trigger deletes other members' rows with the same Expo token on insert.
- **DayReminders no longer caches "on"**; it re-reads the push state on
  mount, sheet open and foreground return.
- **Custom entry** `index.js` imports `src/push/task` before
  `expo-router/entry` (the docs require the task at module scope in an
  early module). `package.json` main points at it.

Later the same day: migration applied and both functions deployed from
this machine, version bumped to 1.0.0, `NOT_AVAILABLE` path removed, and
test pushes with action buttons verified on the owner's phone. What is
still open, plus the owner's follow-up request that iOS actions log without
opening the app, is handed off in `docs/PHASE4.md`.

## Ship: first TestFlight and the Android APK

1. ~~Bump `expo.version` to the store version~~ Done: 1.0.0 (owner
   delegated the choice 2026-10-16), bumped before the first dev build that
   carries expo-notifications. With `runtimeVersion: appVersion`, updates
   only reach builds with the same version string, so every build from here
   (dev, preview, production) is runtime 1.0.0 and no update can land on
   the 0.1.0 binaries that lack the native modules.
2. `npx eas-cli@latest build --profile production --platform ios` (store
   distribution; `autoIncrement` gives the build number; dev builds already
   consumed counter values, which is fine).
3. `npx eas-cli@latest submit --platform ios` with `ascAppId` / `appleTeamId`
   in `eas.json`; first run asks for the Apple ID and an app-specific
   password (or set up an App Store Connect API key with
   `eas credentials --platform ios`; non-interactive submit needs the key).
   TestFlight processing takes 10 to 15 minutes.
4. In App Store Connect: create an internal group first, then an External
   Testing group, add the build, "What to Test", Submit for Beta App Review
   (the first build of a version needs it; later builds of the same version
   may skip it; up to 6 builds per 24 h). Testers tab > Create Public Link
   (limit optional). Builds expire after 90 days (standard, UNVERIFIED on
   the fetched page).
5. Android: `npx eas-cli@latest build --profile preview --platform android`
   interactively the first time (keystore), send the expo.dev install link
   to the Android member (they accept the "unknown source" warning). Push
   for Android waits for owner task 6.
6. EAS Update for JS-only fixes: `npx eas-cli@latest update --channel
   production --environment production --message "..."` (`--environment`
   is required on SDK 55+; the `EXPO_PUBLIC_SUPABASE_*` values must exist in
   that EAS environment, `eas env:list`, or the update bundle has no
   Supabase config). Same for `development` / `preview`. Staged rollout
   `--rollout-percentage`, `eas update:rollback`. A release build receives
   an update after being closed and reopened up to twice.
7. Store listing still missing (owner): screenshots, description, support
   URL, privacy policy URL, App Privacy answers (email address, name, user
   content, user id, push token: linked to the user, App Functionality, no
   tracking), review notes with the test account.

## Interactive notifications: facts

From the SDK 58 docs (notifications, sending, receiving pages) on
2026-10-16; inferences are marked.

- API: `Notifications.setNotificationCategoryAsync(identifier, actions, options)`
  on both platforms. "Categories must be registered before they can be
  used" and "don't use the characters : or - in your category identifier",
  hence `logReading` / `logHifz`. Register at every launch at module scope
  (persistence across launches is not documented), before React mounts, in
  the same module that sets the notification handler.
- `NotificationAction`: `{ identifier, buttonTitle, textInput?: { placeholder, submitButtonTitle }, options?: { opensAppToForeground, isDestructive, isAuthenticationRequired } }`.
  The flags are Apple's `UNNotificationActionOptions` (inference). Android
  shows at most three buttons (platform limit, not in the Expo docs).
- Responses: `NotificationResponse = { actionIdentifier, notification, userText? }`.
  A body tap has `actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER`
  (`'expo.modules.notifications.actions.DEFAULT'`); a text action delivers
  `userText` as a string (validate: integer 1 to 604). Cold start:
  `useLastNotificationResponse()` (undefined while loading, null if none)
  then `clearLastNotificationResponseAsync()`.
- **Without opening the app:**
  - Android: `Notifications.registerTaskAsync(taskName)` with
    `TaskManager.defineTask` at module scope in a file required early
    (`src/push/task.ts` imported from the entry): "the task also runs in
    response to a notification action tap when the app is backgrounded or
    terminated". `'actionIdentifier' in data` marks a response; it carries
    `actionIdentifier` and `userText`. The exact `NotificationTaskPayload`
    fields were not in the fetched text: read the type in node_modules
    before relying on them. The Supabase insert runs there with the stored
    session (secure-store adapter works headlessly; confirm on device).
  - iOS: no documented headless path for an action tap. The only headless
    trigger is a silent push (`contentAvailable`, needs the plugin's
    `enableBackgroundRemoteNotifications`, limited to a few per hour), which
    is a different mechanism and NOT what this feature wants. Decision: on
    iOS the actions use `opensAppToForeground: true` and the app opens
    straight into the log sheet prefilled with the chosen type and amount
    (the `/today?log=<type>` path already exists; add an `amount` param the
    sheet reads once), where the member only taps Save. If a device test
    shows `opensAppToForeground: false` delivers the response reliably
    while the app is backgrounded (general iOS behaviour, inference), keep
    the headless write for that case too, but never depend on it.
  - Either way: make the insert idempotent (client-generated id or a
    `(user_id, logged_at)` check) and queue it in prefs on failure, because
    a headless run has no UI for errors; a local confirmation notification
    is the feedback ("Logged 5 pages. Streak: 12 days.").
- Server: the Expo push message field is `categoryId` (both platforms);
  `channelId` must exist on the device (create `iqra` before the token);
  `collapseId` replaces a displayed notification on iOS and coalesces in
  transit on Android; the whole payload is capped at 4 KiB. The SQL payload
  gains `category`; the web-push branch ignores it.
- Local testing on the simulator: `scheduleNotificationAsync({ content: { title, body, categoryIdentifier: 'logReading', data: { url: '/today' } }, trigger: { seconds: 5 } })`
  shows the buttons and the text field without a server. The docs mark
  `categoryIdentifier` on scheduled content as iOS; test Android actions
  with a real push. The docs also claim iOS 16+ simulators can receive
  remote pushes (`xcrun simctl push` with an `.apns` file); the current
  `Device.isDevice` guard would skip token registration there, so decide
  deliberately.
- Android 13 permission prompt only appears after a channel exists; Expo Go
  cannot receive push on Android (dev build required); SDK 58 shows
  foreground notifications by default and drops a handler that takes over
  3 s, so the handler stays synchronous-fast.

## Testing checklist (real devices; the simulator cannot receive remote pushes)

1. Toggle on in Settings: permission prompt, a `push_subscriptions` row
   with an `expo` key, `platform` and `device`; toggle twice more: still one
   row. Toggle off: row gone. Sign out: row gone before the login screen.
2. From another account send a chat message: push arrives with the sender
   as title; tapping opens Chat. With Chat on screen and the app active, no
   banner; on another tab, banner. A nudge pushes "X nudged you" and opens
   Today even while Chat is on screen.
3. Set a one-time reminder for +2 min with a type: the push shows the
   action buttons; "Log 1 page" writes an entry visible on Today and in
   Feed; "Other…" with "3" writes 3 pages; "abc" opens the log sheet. The
   deep link `/today?log=<type>&r=<id>` opens the sheet once, not again on
   refocus.
4. Kill the app, repeat 2 and 3 (background delivery, cold-start routing
   through the auth gate). Sign out, tap a push: login first, then the
   deep link lands.
5. Sunday recap (or `select send_push(...)` from the SQL editor with
   `url: '/stats#recap'`): Insights scrolls to "Your week".
6. Delete account on a throwaway member: function returns ok, the user is
   gone from auth and every table, the app is on the login screen.
7. `eas update` a trivial copy change to the development channel and see
   it land on the dev build after two cold launches.
8. The simulator CAN show local notifications: use
   `scheduleNotificationAsync` with the category to test the action
   buttons and the text input without a server (exact option name in the
   facts section).

## Kickoff brief for the next session (paste as the first message)

```
I'm continuing the Iqra native migration (Expo SDK 58, Expo Router, React 19,
RN 0.88). Phases 0-2 are done and verified on device; Phase 2 is on my phone
from EAS dev build ff2ff734 with Metro on port 8082. You are starting Phase 3:
push, deep links, interactive log-from-the-notification actions, account
deletion, first TestFlight and the Android APK.

Read in this order before touching anything:
1. CLAUDE.md (non-negotiables, commit policy)
2. docs/PHASE3.md (the plan, the owner tasks, every decision; it corrects
   docs/PUSH.md where the two differ)
3. docs/HANDOFF.md (Status table and the working notes at the bottom,
   especially the dev-build install and stale-Metro notes, the NativeTabs
   inset rule and the simulator-testing note)
4. docs/DECISIONS.md § Notifications
5. The SDK 58 docs for every Expo API you touch (AGENTS.md); node_modules
   types are the truth.

Rules: Phase 3 is single-threaded (one thread of decisions); use Sonnet or
Opus subagents for research, review and scoped fixes, never Haiku, and look
over their outcomes yourself. src/lib stays RN-free (push code goes in
src/push/). Migrations and edge functions cannot be pushed from this
machine: write the files and tell me exactly what to paste and deploy, and
when. No em dashes anywhere. Commit per concern with a body that says why;
do not push. Run npx tsc --noEmit and npx expo lint before calling anything
done. Metro for my phone runs on 8082 in my terminal; if you need Metro for
the simulator use another port. After adding expo-notifications tell me to
rebuild the dev client (eas build --profile development --platform ios);
builds auto-increment now.

Order of work: (1) expo-notifications install + plugin + src/push
registration + Settings toggle + sign-out cleanup, (2) PushController with
the foreground handler and tap routing through the auth gate, (3) the
notification categories (logReading / logHifz), the Android task and the
iOS prefilled-sheet path, (4) the
send-push Expo branch and the Phase 3 migration, (5) delete-account
function, (6) version bump, production build, eas submit, TestFlight group,
Android APK, eas update check. Give me the owner steps as they come up, one
at a time, and stop for my input only where PHASE3.md says a decision is
mine.
```
