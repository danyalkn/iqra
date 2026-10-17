# Next session handoff - ship Phase 3, headless iOS actions, Phase 4 Screen Time

Written 2026-10-16 at the end of the Phase 3 build session, for a fresh
session (the owner intends to run it on Opus) and the owner. Read
`CLAUDE.md`, then this file, then `docs/PHASE3.md` (the plan that was built,
with "Progress and decisions made while building" and the testing
checklist), `docs/HANDOFF.md` (Status, working notes) and
`docs/SCREEN-TIME.md` (the Phase 4 design). Everything below was checked
against the code and the live Supabase project on 2026-10-16.

Three pieces of work, in this order:

1. **Finish Phase 3**: device checklist, production build, TestFlight,
   Android APK, EAS Update smoke test. Mostly owner-driven commands; the
   agent prepares and verifies.
2. **Owner feature request (2026-10-16): iOS log actions must not open
   the app.** "Log 5 pages" on a reminder should write the entry from the
   notification itself, as Android already does. Design and options below.
3. **Phase 4: Screen Time** (`docs/SCREEN-TIME.md`), gated on Apple.

## State of play

- Phases 0 to 3 are code complete. The Phase 3 push stack is verified on
  the owner's iPhone 16 Pro: toggle on registers an Expo row, reminder
  pushes with `category` show the action buttons, taps and actions open
  the app into the prefilled log sheet. Test pushes were sent from SQL with
  `select public.send_push(array['<uid>']::uuid[], jsonb_build_object(...))`
  and the edge function answered `{ sent: 6, removed: 0, errors: [] }`.
- **Supabase is reachable from this machine** (CLI logged into the owner's
  account, linked to `uqsdzraczxkinvefrbog`). Apply a migration with
  `supabase db query --linked -f supabase/migrations/<file>.sql`, record it
  with `supabase migration repair --status applied <version>`, never
  `db push`. Deploy with `supabase functions deploy <name>`. Read-only
  checks: `supabase db query --linked -o json "<sql>"` (one statement's
  result comes back; chain `pg_sleep` for async pg_net results in
  `net._http_response`). Deployed: `send-push` v6, `delete-account` v1.
- `app.json` is at `version` **1.0.0** (owner delegated the choice);
  `runtimeVersion` follows it, so every build from here is runtime 1.0.0.
- EAS: logged in as `danyal0726`; the Apple ID for builds is
  `danyal@theqadamapp.com`, team Qadam Technologies Inc. `eas.json`
  `submit.production` is still empty (fill `ios.ascAppId` and
  `appleTeamId` after the first submit creates the app record).
- Git: everything is committed on `main`, nothing pushed (owner rule: do
  not push unless asked). Commit per concern with a body that says why.
- Metro for the phone runs on port 8082 in the owner's terminal
  (`npx expo start --port 8082`; 8081 is taken by another project). The
  dev build with the Phase 3 native modules is installed on the phone and
  loads its JS from that Metro, so every JS change reaches the phone on
  reload while it runs; if it was stopped, the owner restarts it with
  `--clear` (a Metro left running across `npx expo install` serves a stale
  module graph). Use another port for the simulator. The phone must be on
  the same network as this Mac.

### Owner tasks still open

1. Privacy policy URL and a test account for Beta App Review (a page on
   iqra.fly.dev is fine until the PWA retires).
2. App Store Connect app record: `eas submit` offers to create it; or make
   it by hand (name Iqra, bundle id `com.qadamtechnologies.iqra`, SKU
   `iqra-ios`, English).
3. **File the four Family Controls (Distribution) requests** as the
   Account Holder (`docs/SCREEN-TIME.md` has the form text). Days to weeks;
   this is the long pole of Phase 4 and nothing else can shorten it.
4. Android push: Firebase project, `google-services.json`, FCM V1 key via
   `eas credentials` (PHASE3.md owner task 6). Not needed for TestFlight.
5. First Android build interactively so EAS creates the keystore.

## 1. Finish Phase 3

### Device checklist still open (from PHASE3.md "Testing checklist")

Verified so far: item 1 toggle-on (row with `expo`, `platform`, `device`),
item 3 partially (buttons show, actions open the prefilled sheet). Still to
run, with the agent checking `push_subscriptions` and `log_entries` from
SQL after each:

- Toggle on twice more: still one row. Toggle off: row gone. Sign out: row
  gone before the login screen appears; sign back in: row returns on its
  own (the enabled flag survives sign-out by decision).
- Chat push from a second account (title is the sender, tap opens Chat);
  no banner while Chat is on screen and the app is active; banner on
  another tab. A nudge always shows.
- A real one-time reminder set from Today for +2 min with a type: the push
  carries the buttons; `/today?log=<type>&r=<id>` opens the sheet once,
  not again on refocus.
- Kill the app and repeat a tap (cold start through the gate). Sign out,
  tap a push, log in: the link lands after login.
- Recap deep link (`url: '/stats#recap'`) scrolls Insights to "Your week".
- Delete account on a throwaway member: `{ ok: true }`, user gone from
  `auth.users` and every table, app on the login screen.
- `eas update` a trivial copy change to the development channel; it lands
  after two cold launches.

### Ship steps

1. **Production build** (owner, interactive Apple login the first time to
   create the App Store provisioning profile):
   `npx eas-cli@latest build --profile production --platform ios`.
2. **Submit** (owner): `npx eas-cli@latest submit --platform ios --latest`.
   EAS can create the App Store Connect record. Afterwards the agent writes
   `submit.production.ios.ascAppId` and `appleTeamId` into `eas.json` and
   commits, so later submits are non-interactive (an App Store Connect API
   key via `eas credentials --platform ios` makes them fully so).
3. **TestFlight**: internal group first (owner installs at once), then an
   External Testing group, "What to Test", Submit for Beta App Review
   (needs owner tasks 1 and 2), then Testers > Create Public Link.
4. **Android APK**: `npx eas-cli@latest build --profile preview --platform android`
   interactively the first time; send the expo.dev link to the Android
   member. No pushes for them until owner task 4.
5. **EAS Update** for every JS fix from now on:
   `npx eas-cli@latest update --channel production --environment production --message "..."`
   (`--environment` is required on SDK 55+; `EXPO_PUBLIC_SUPABASE_*` must
   exist in that EAS environment, `eas env:list`). `development` and
   `preview` channels the same way.
6. Store listing (owner, later): screenshots, description, support URL,
   App Privacy answers (email, name, user content, user id, push token;
   linked to the user; App Functionality; no tracking), review notes with
   the test account.

## 2. Owner feature: iOS actions log without opening the app

### What exists

- Android already does it: `src/push/task.ts` (TaskManager task defined
  from `index.js`) runs on an action tap with the app backgrounded or
  killed and calls `performLog` in `src/push/actions.ts`, which writes the
  entry with the sheet's defaults (`continuedEntry` in
  `src/lib/entryDefaults.ts`), confirms with a local notification
  ("Logged 5 pages. Streak: 12 days.") and marks Today for a refetch.
  Idempotent per delivered push (`responseKey`: `data.sendId` from
  send-push), refuses pushes whose `data.uid` is another member, in-flight
  guard against double taps. **Untested on a real Android device** (no
  device yet); test it before touching iOS.
- iOS actions are registered with `opensAppToForeground: true`
  (`src/push/categories.ts`) and `PushController` routes them to
  `/today?log=<type>&amount=<n>` (the prefilled sheet). The write path is
  platform-neutral: `performLog` runs anywhere JS runs.

### Why iOS was left opening the app

The SDK 58 docs give no headless path for an action on iOS; the only
background trigger they document is a silent push. Apple's own model,
however, is: an action **without** the foreground option makes the system
launch or wake the app **in the background** and deliver the response to
`userNotificationCenter(_:didReceive:withCompletionHandler:)`. Two things
to know about expo-notifications' implementation
(`node_modules/expo-notifications/ios/ExpoNotifications/Notifications/Emitter/EmitterModule.swift`):
it stores the response as `lastResponse`, emits the JS event, and calls
the completion handler **immediately** (line 39). So after a background
launch the app has only the few seconds iOS grants before suspension, and
nothing holds a background task open for the Supabase insert.

### Options, in the order to try

**Result (2026-10-17): option A shipped** (commits 05062f2..ac62032,
EAS update to production) and logged on the owner's iPhone from a
TestFlight build. Still to confirm: a swiped-away app on a locked phone.
Fall back to B only if that state loses writes.

**A. JS-only, test first (an hour).** Set `opensAppToForeground: false`
for the iOS actions. In `PushController.onResponse`, when `Platform.OS ===
"ios"` and `AppState.currentState !== "active"`, call `performLog(parsed,
responseKey(response))` instead of queuing the sheet href, then dismiss
the notification and clear the last response (mirror `task.ts`). Keep the
foreground path (sheet) for taps while the app is open, and keep the
`invalidAmount` / `signedOut` / `wrongUser` notifications. Test on the
phone with the app killed, backgrounded, and locked: does the response
arrive (watch Metro logs), does the insert complete before suspension,
does the confirmation show? If it works reliably, ship it and record the
decision in PHASE3.md. Risks: the completion handler returns before the
write, so iOS may suspend mid-insert on a slow network; the "Other amount"
text action behaves the same way.

**B. Hold a background task (small native change).** If A loses writes,
a local Expo module (or a config plugin patching the delegate) that calls
`UIApplication.shared.beginBackgroundTask` when a non-foreground response
arrives and ends it after ~25 s or when JS reports done gives the insert
the time it needs. Keep it tiny; the owner wants no app-wide native sprawl.

**C. Notification Content Extension (the Apple-sanctioned way).** A
`UNNotificationContentExtension` target handles action taps itself
(`didReceive(_:completionHandler:)` returning `.dismiss`) without
launching the app, and can call Supabase REST directly with URLSession.
Needs: a config plugin adding the extension target (Phase 4 will add
Swift extension targets anyway, so the plumbing is shared), the session
token readable by the extension (expo-secure-store supports
`accessGroup`, so store a copy of the access and refresh tokens under a
shared keychain access group from the app), and the entry construction
re-implemented in Swift (or kept minimal: POST the row with the amount and
let a new SQL function `log_from_notification(type, amount)` compute the
continuation server-side, which is the cleaner split). Most work, most
robust, and it also makes the Android path simpler if the SQL function
exists. Choose C only if A and B fail or feel fragile on device.

Whatever lands: the local confirmation stays the only feedback, the
`iqra:push-logged` pref guard and `data.sendId` dedupe stay, and a tap on
the confirmation opens Today. Update PHASE3.md "Progress and decisions"
and the `src/push/categories.ts` header comment.

## 3. Phase 4: Screen Time

Design in `docs/SCREEN-TIME.md`. Summary: the member picks apps with
`FamilyActivityPicker`; a ManagedSettings shield blocks them until today's
entry is logged; a DeviceActivity schedule re-applies the shield at
profile-local midnight. Opt-in, per device, `.individual` authorization.
Library `react-native-device-activity` (Kingstinct) with its config plugin,
Apple Team ID and the App Group `group.com.qadamtechnologies.iqra`. Three
extension targets (`ActivityMonitorExtension`, `ShieldConfiguration`,
`ShieldAction`) each need the Family Controls entitlement.

Sequence:

1. Owner files the four Distribution requests now (owner task 3). Until
   approval, build with the **Development** entitlement on the dev client
   and test on the phone; TestFlight builds must not include the capability
   or signing fails.
2. Settings > Focus section: toggle, app picker, "shield until logged"
   state; unshield on the first entry of the day (hook into the same
   `insertEntry` success path Today and the notification actions share);
   reshield at midnight via the schedule. Android: `docs/SCREEN-TIME.md`
   § Android (UsageStats + overlay; sideloaded, so no Play policy review).
3. Use Xcode 26's Claude Agent only for the Swift extension targets and
   signing issues, never for RN code (owner rule).
4. Ship in a later TestFlight build after Apple approves; do not block the
   first TestFlight on it.

## Kickoff brief for the next session (paste as the first message)

```
I'm continuing the Iqra native migration (Expo SDK 58, Expo Router, React 19,
RN 0.88). Phases 0-3 are code complete; Phase 3 push is verified on my
phone and the Supabase side (migration, send-push, delete-account) is live.
Read in this order before touching anything: CLAUDE.md, docs/PHASE4.md
(this handoff: state, owner tasks, three pieces of work, decisions),
docs/PHASE3.md ("Progress and decisions made while building", the testing
checklist), docs/HANDOFF.md (Status and working notes), docs/SCREEN-TIME.md.
The SDK 58 docs and node_modules types are the truth for every Expo API.

Rules: single-threaded (one thread of decisions); Sonnet or Opus subagents
for research, review and scoped fixes, never Haiku, and look over their
outcomes yourself; an independent review before device testing found real
defects last time, keep doing it. src/lib stays RN-free. Supabase is
reachable from this machine (see PHASE4.md "State of play" for the exact
commands; never `db push`). No em dashes anywhere. Commit per concern with a
body that says why; do not push. npx tsc --noEmit and npx expo lint before
calling anything done. Metro for my phone is on 8082 in my terminal. If a
step needs my credentials, ask me to unblock it once rather than handing me
a list of steps.

Order of work: (1) finish the Phase 3 device checklist with me and ship:
production build, eas submit, TestFlight group, Android APK, eas update
check; (2) make the iOS reminder actions log WITHOUT opening the app (the
whole point of the feature): try option A in PHASE4.md first on device,
then B, then C; (3) Phase 4 Screen Time per docs/SCREEN-TIME.md, starting
with telling me to file the Family Controls requests. Give me owner steps
one at a time as they come up.
```
