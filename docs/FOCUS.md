# Focus (Screen Time) - build session handoff

Written 2026-10-21, the day Apple approved the Family Controls
(Distribution) entitlement, for a fresh session that builds the feature.
Read `CLAUDE.md`, then this file, then `docs/SCREEN-TIME.md` (design and
the Apple process, already done), `docs/DECISIONS.md` ("Logging",
"Notifications"), and `docs/NEXT-SESSION.md` "Offline logging: what was
built" (the write path you hook into). `docs/HANDOFF.md` Status is the
project-wide table; update it at the end.

The feature is called **Focus** in the app. Screen Time, Family Controls,
ManagedSettings and DeviceActivity are Apple's names; they never appear in
user-facing copy.

## What the feature is

A member turns on Focus in Profile > Settings, picks the apps they find
distracting, and those apps are blocked on their own iPhone until they
log today's Quran in Iqra. The block comes back at midnight. They can
pause it for the rest of the day or turn it off whenever they like.
Opt-in, per device, self-control only: Iqra never blocks, monitors or
reports on anyone else's phone, and nothing about it is shown to the
circle.

## State of play (2026-10-21)

- **Apple**: Family Controls (Distribution) is assigned to the Qadam
  Technologies Inc. account (Team ID `69BV989JDV`, Request ID GS68KZ6855,
  filed and approved 2026-10-21). It is one account-wide grant; nothing
  else to file. The four App IDs exist in Certificates, Identifiers &
  Profiles: `com.qadamtechnologies.iqra`, `.ActivityMonitorExtension`,
  `.ShieldConfiguration`, `.ShieldAction`. **First thing: ask the owner
  whether they ticked "Family Controls (Distribution)" under Additional
  Capabilities on all four.** If not, that is their only remaining Apple
  step; EAS may also do it on the first build (its capability sync covers
  standard capabilities; managed ones are not guaranteed), so check the
  portal after that build either way.
- **Library**: `react-native-device-activity` 0.6.1 (Kingstinct, released
  2026-02-19, peers `expo >= 52`, iOS only, `platforms: ["ios"]`). Not yet
  installed. Its config plugin adds three extension targets from its
  `targets/` folder and gives the main app the Family Controls entitlement
  plus the App Group. Extension bundle ids are `<main id>.<folder name>`
  (`@kingstinct/expo-apple-targets` 0.1.19 `withWidget.js`), so the
  monitor is `.ActivityMonitorExtension`; the README's `.ActivityMonitor`
  is stale.
- **Builds**: iOS 1.0.0 (3) is on TestFlight, runtime 1.0.0; the owner's
  phone runs it, so Metro does not reach the phone today. Android 1.1.0
  build 4 (runtime 1.1.0) is built and waits on the Android member's
  install (`docs/ANDROID.md`). `app.json` has root `version: "1.0.0"` and
  `android.version: "1.1.0"`. `runtimeVersion` policy is `appVersion`.
- **JS shipping**: iOS fixes go out with
  `npx eas-cli@latest update --channel production --environment production --platform ios --message "..." --non-interactive`
  and Android with `--channel preview --environment preview --platform android`.
  Do NOT send Android updates until the Android member is on 1.1.0
  (memory rule from the Android session).
- **Native dirs**: `ios/` and `android/` are gitignored CNG output
  (`npx expo run:ios` generated them). `expo run:*` rewrites the
  ios/android scripts in `package.json`; `git checkout -- package.json`
  afterwards.
- **Accounts**: EAS login `danyal0726` (project `@danyal0726/iqra`); Apple
  ID `danyal@theqadamapp.com`; ASC app id 6823874106 with an API key on
  EAS, so `eas submit` is non-interactive. Supabase CLI linked; nothing in
  this feature touches the database.
- **Git**: everything committed on `main`, pushed to github.com/danyalkn/iqra
  through ffffd20; the four 2026-10-21 docs commits are local. Do not push
  unless asked.

## Decisions already made

From `docs/SCREEN-TIME.md`, `docs/DECISIONS.md` and Apple's terms:

1. **Authorization is `.individual`.** The member manages their own phone.
   Never request `child`.
2. **"Logged today" means an entry dated today in the profile's time zone**,
   the same `localDate(e.logged_at, tz) === today` rule Today uses for the
   streak. Any entry type counts (reading or hifz). A backdated entry
   ("Saved to yesterday", possible until 3 AM) does not unlock today.
3. **A queued (offline) entry counts the moment it is queued.** Offline
   logging was built so that logging never needs a connection; the shield
   must not either. Unlock on enqueue, not on sync.
4. **Midnight is device-local for the re-block** (DeviceActivity schedules
   only know device time) and **profile-local for the unlock**. They differ
   only when the phone's zone and the profile zone disagree; accepted for
   a five-person circle. Note it in DECISIONS.
5. **Pause for today always exists** and is never shamed: a stuck shield
   with no escape is how people uninstall apps. Turning Focus off clears
   everything at once.
6. **No server state, nothing shown to the circle.** Apple's terms bar
   sharing framework data "beyond ... the individual and their device".
   No feed items, no chat messages, no stats about blocking. If the owner
   ever asks for a focus streak, it stays private to the member
   (SCREEN-TIME.md "Data").
7. **Opaque tokens only.** Iqra never learns app names. Show counts
   ("3 apps, 1 category" via `activitySelectionMetadata`).
8. **Shield copy is plain language, no em dashes**, Paper & Pine colors.
9. **Xcode 26's Claude Agent only for Swift targets and signing**, never
   for RN code (owner rule). The library's Swift is prewritten; you should
   not need Xcode at all unless provisioning breaks.

### Ask the owner before building (one message, all at once)

- Shield wording. Proposed: title "Iqra", subtitle "Log today's Quran in
  Iqra to unlock this app.", primary "Open Iqra", secondary "Not now".
- Whether the Focus card should hide on Android for now or show a one-line
  "Coming to Android" note. Proposed: hide (`Platform.OS === "ios"` and
  `isAvailable()`).
- Confirm decision 2 (hifz entries unlock too) and 5 (unlimited pauses).

## Technical plan

Mirror `src/push/`: a `src/focus/` module owns every native call and the
controller; the pure date rule lives in `src/lib/`.

### 1. Dependency and config (one commit: `feat(focus): add Screen Time library and extension targets`)

1. `npx expo install react-native-device-activity`. Check it resolves to
   0.6.1 and that `npx expo-doctor` stays clean.
2. `app.json` plugins, after `expo-notifications`:
   ```json
   ["react-native-device-activity", {
     "appleTeamId": "69BV989JDV",
     "appGroup": "group.com.qadamtechnologies.iqra"
   }]
   ```
   The README also adds `expo-build-properties` with
   `ios.deploymentTarget: "15.1"`. SDK 58 / RN 0.88 already target a newer
   iOS (`node_modules/react-native/scripts/cocoapods/helpers.rb`
   `min_ios_version_supported`); only add build-properties if prebuild
   complains.
3. **Version**: set root `version` to `"1.1.0"` and remove
   `android.version` (both platforms are 1.1.0 now; say so in the commit
   body, referencing ANDROID.md "Versioning"). This moves iOS to runtime
   1.1.0: the TestFlight 1.0.0 build stops receiving JS until the owner
   installs the 1.1.0 build. Say this to the owner before the first iOS
   update after the bump.
4. `npx expo prebuild --platform ios --clean` locally and verify:
   `ios/Iqra/Iqra.entitlements` has `com.apple.developer.family-controls`
   and the App Group; `ios/` has `ActivityMonitorExtension`,
   `ShieldConfiguration`, `ShieldAction` targets with the same two
   entitlements; `npx expo config --type public` shows
   `extra.eas.build.experimental.ios.appExtensions` with the three bundle
   ids (that is how EAS learns to provision them). Then
   `git checkout -- package.json` if scripts changed.
5. **Android safety**: the package has no Android native module and its
   iOS module file uses `requireOptionalNativeModule`, so importing it on
   Android does not throw, but confirm by running the Android emulator
   once after the feature lands (an Android `preview` update will
   eventually carry this JS to build 4, which has no such native code).
   Still gate every call behind `Platform.OS === "ios" && isAvailable()`.

### 2. Pure logic (`src/lib/focus.ts`, RN-free, unit-testable by reading)

```ts
export type FocusState = {
  enabled: boolean;
  /** Profile-local ymd of the last entry logged from this device. */
  lastLoggedDay: string | null;
  /** Profile-local ymd the member paused for, or null. */
  pausedDay: string | null;
};
/** True when the shield should be down right now. */
export function focusUnlocked(s: FocusState, today: string): boolean
```
`today` is `todayLocal(tz)` from `src/lib/dates.ts`. Keep the file free
of `react-native` imports (CLAUDE.md rule).

### 3. Native wrapper (`src/focus/focus.ts`)

Constants: `SELECTION_ID = "iqra-focus"`, `SHIELD_ID = "iqra-focus-shield"`,
`ACTIVITY = "iqra-focus"` (the library only applies a shield to selection
ids contained in a monitored activity name, README "Some Notes", so the
activity name must contain the selection id: these do).

Library calls, from `build/index.d.ts`:

| Step | Call |
|---|---|
| Availability | `isAvailable()` (false on Android, simulator, old iOS) |
| Enable | `requestAuthorization("individual")`, then `pollAuthorizationStatus()` (status lags; README "Weird behaviors") |
| Status | `getAuthorizationStatus()`, `useAuthorizationStatus()`; a change made in iOS Settings is only seen after an app restart |
| Pick apps | `DeviceActivitySelectionSheetView` (native sheet; a 1x1 absolute anchor, `onDismissRequest`, `onSelectionChange`), token from `event.nativeEvent.familyActivitySelection` |
| Persist selection | `setFamilyActivitySelectionId({ id: SELECTION_ID, familyActivitySelection })` (App Group UserDefaults, readable by the extensions) |
| Counts | `activitySelectionMetadata({ activitySelectionId: SELECTION_ID })` |
| Shield look | `updateShieldWithId(config, actions, SHIELD_ID)` |
| Midnight re-block | `configureActions({ activityName: ACTIVITY, callbackName: "intervalDidStart", actions: [{ type: "blockSelection", familyActivitySelectionId: SELECTION_ID, shieldId: SHIELD_ID }] })` then `startMonitoring(ACTIVITY, { intervalStart: { hour: 0, minute: 0 }, intervalEnd: { hour: 23, minute: 59 }, repeats: true }, [])` |
| Block now | `blockSelection({ activitySelectionId: SELECTION_ID })` |
| Unblock now | `unblockSelection({ activitySelectionId: SELECTION_ID })` |
| Turn off | `stopMonitoring([ACTIVITY])`, `resetBlocks()`, `cleanUpAfterActivity(ACTIVITY)`; keep the authorization |
| Is it on | `isShieldActive()` for the status line |

Do not configure `intervalDidEnd` to unblock: the day ends at 23:59 and
the next `intervalDidStart` is a minute later, and an unblock there would
free the apps for anyone who did not log. Blocking is the default; the
app removes it.

Shield config (colors are `{ red, green, blue }` 0-255 from
`src/constants/theme.ts`; accent `#157f43` = 21, 127, 67):
`title`, `subtitle`, `iconSystemName: "book.closed.fill"`,
`iconTint` accent, `primaryButtonLabel`, `primaryButtonBackgroundColor`
accent, `secondaryButtonLabel`, `backgroundBlurStyle` system material.
Actions: primary `{ behavior: "close", actions: [{ type: "openApp" }] }`;
if `openApp` does nothing on device (Apple does not let shields open
apps; the library's implementation is a best effort), fall back to
`{ type: "sendNotification", payload: { title: "Iqra", body: "Log today's Quran to unlock your apps.", categoryIdentifier: "logReading", userInfo: { url: "/today?log=reading" } } }`.
`userInfo` arrives as `response.notification.request.content.data`, so
`PushController` routes `url` through `toNativeHref` and the
`logReading` category (`src/push/categories.ts`) puts the Log buttons on
the banner, so the member can log from the shield's notification without
opening the app. Secondary: `{ behavior: "close" }`.

### 4. State and the controller (`src/focus/FocusController.tsx`, `src/storage/prefs.ts`)

Prefs (add to `PREF_KEYS`, per device like `pushToken`, but stamp the
userId inside so a second account on the phone does not inherit it):
`iqra:focus` -> JSON `{ userId, enabled, lastLoggedDay, pausedDay }`.

`reconcileFocus(userId, tz)`: read the pref, compute
`focusUnlocked(state, todayLocal(tz))`, call `unblockSelection` or
`blockSelection`, idempotently. Call it:

- on every enqueue of a new entry: `today.tsx` `handleSave` after
  `await enqueue(item)` and `src/push/actions.ts` after its `enqueue`
  (the headless path; both set `lastLoggedDay = localDate(item.entry.logged_at, tz)`
  first, so a backdated entry sets yesterday and does not unlock);
- when the app becomes active (an `AppState` listener, same shape as
  `SyncController`), which also covers the first open after midnight;
- when `useNow()` crosses midnight while the app is open (Today already
  recomputes `today` from `useNow`);
- after the picker closes and after pause / unpause / turn off.

Mount `<FocusController />` in `src/app/_layout.tsx` next to
`SyncController`. Keep `src/data/sync.ts` out of it: unlock happens at
enqueue, so sync has nothing to add. The headless path runs in a
background launch; a synchronous ManagedSettings call from there is
expected to work, but it is on the device checklist.

### 5. Settings UI (`src/components/settings/FocusCard.tsx`)

In `src/app/(tabs)/profile.tsx` Settings, after `NotificationsToggle`.
Follow `NotificationsToggle.tsx` (states, `Card`, `Switch`, `FieldLabel`,
re-check on foreground). States:

- hidden when `Platform.OS !== "ios"` or `!isAvailable()`;
- **off**: switch plus one line, "Block the apps you choose until you've
  logged today's Quran."; turning on requests authorization, then opens
  the picker; a cancelled picker leaves it off;
- **denied**: "Iqra needs Screen Time access. Allow it in Settings." with
  a button to `Linking.openSettings()`; note the restart quirk in copy
  ("then reopen Iqra");
- **on**: "3 apps, 1 category" with "Change apps"; a status line,
  "Blocked until you log today" or "Unlocked for today"; "Pause until
  tomorrow" (becomes "Paused until tomorrow" with "Resume"); the switch
  turns it off.

Plain language, no jargon, no em dashes. Dark mode via `useTheme()`.

### 6. Build, test, ship

1. `npx tsc --noEmit`, `npx expo lint`, `npx expo-doctor`; commit per
   concern (deps/config, lib rule, focus module, settings card, docs).
2. **Dev build for iteration**: `npx eas-cli@latest build --profile development --platform ios`
   interactively the first time (EAS creates provisioning profiles for the
   three new extension bundle ids and may ask for the Apple login; the
   owner's UDID is already registered). Installing it replaces the
   TestFlight app on the owner's phone (same bundle id; data survives).
   Tell the owner that beforehand. The owner runs Metro on 8082
   (`npx expo start --port 8082`), same network; the simulator cannot run
   any of this (authorization never completes, picker empty, extensions
   never fire), so this feature is phone-only.
3. **Independent review** (Opus or Sonnet subagent, never Haiku) of the
   diff before the device checklist; it found real defects every prior
   phase.
4. Device checklist, with the owner (give steps one at a time, say why
   each matters in one line):
   - enable, pick 2 apps, confirm they are shielded at once (nothing
     logged today), shield shows Iqra's copy and colors;
   - log 1 page from Today: apps open within seconds;
   - delete that entry: shield stays down (we do not re-block on delete;
     say so if the owner disagrees);
   - shield primary button: does `openApp` open Iqra? If not, the
     notification fallback, and its Log button logs headless and unlocks;
   - airplane mode, log 1 page: unlocks offline; entry syncs later;
   - reminder push button (lock screen, app killed) logs and unlocks;
   - pause: unlocks until tomorrow; resume: re-blocks;
   - turn off: everything cleared, picker selection gone on re-enable;
   - revoke Screen Time access in iOS Settings, reopen Iqra: card shows
     denied, nothing stays blocked;
   - **overnight**: logged yesterday, phone idle, at 00:00 the apps are
     blocked again without opening Iqra (the monitor extension did it);
     then log at 00:30 "yesterday" (backdated) and confirm it does NOT
     unlock; log today and confirm it does. For a same-day rehearsal, a
     dev-only switch can start a one-off schedule a minute from now
     (README `testSchedule`); remove it before shipping.
5. **Ship**: `npx eas-cli@latest build --profile production --platform ios --non-interactive`,
   then `npx eas-cli@latest submit --platform ios --latest`. In App Store
   Connect the external group "Circle" picks up the build; a new version
   may need a short Beta App Review (What to Test: "Focus: block apps
   until you log today's Quran. Self-control only."). From then on iOS
   JS updates target runtime 1.1.0.
6. Android: unchanged for now. `docs/SCREEN-TIME.md` § Android is the
   plan (UsageStats + overlay; `expo-app-blocker` 0.1.77, last published
   2026-07-05, to evaluate first). Separate session.

### 7. Docs to update at the end

- `docs/HANDOFF.md` Status row 4 and working notes.
- `docs/DECISIONS.md`: new "Focus" section (decisions 1 to 8 above, plus
  whatever the owner answered).
- `docs/SCREEN-TIME.md`: a "Progress" section like ANDROID.md's.
- `docs/NEXT-SESSION.md` owner check 3: done.
- The memory file `iqra-native-migration.md` (ship state, runtime 1.1.0).

## Kickoff brief for the next session (paste as the first message)

```
I'm continuing the Iqra native app (Expo SDK 58, Expo Router, React 19,
RN 0.88). iOS 1.0.0 is on TestFlight, Android 1.1.0 build 4 is built, JS
ships by EAS Update (production = iOS, preview = Android; no Android
updates until the Android member installs build 4).

This session builds Focus (Screen Time app blocking until today's Quran
is logged). Apple approved the Family Controls (Distribution) entitlement
on 2026-10-21 and the four App IDs exist. Read in this order before
touching anything: CLAUDE.md, docs/FOCUS.md (this handoff: state,
decisions, the technical plan, the device checklist, what to ask me),
docs/SCREEN-TIME.md, docs/DECISIONS.md ("Logging", "Notifications"),
docs/NEXT-SESSION.md "Offline logging: what was built". The SDK 58 docs,
node_modules types and the library's build/index.d.ts are the truth for
every API; its README is partly stale (FOCUS.md says where).

Start by asking me, in one message, the questions FOCUS.md lists under
"Ask the owner before building" plus whether I ticked Family Controls
(Distribution) on all four App IDs. Then build it per FOCUS.md: library
and config, version 1.1.0, the pure rule in src/lib (RN-free), the
src/focus module and controller, the Focus card in Profile > Settings,
an independent review, then the device checklist with me one step at a
time (the simulator cannot run Screen Time; my phone is needed and the
dev build will replace my TestFlight install). Then the production build
and TestFlight.

Rules: single thread of decisions; Sonnet or Opus subagents for research,
review and scoped fixes, never Haiku, and look over their outcomes
yourself. src/lib stays RN-free. No em dashes anywhere, including shield
and notification text. Plain-language copy. Commit per concern with a
body that says why; do not push unless I ask. npx tsc --noEmit, npx expo
lint and npx expo-doctor before calling anything done. If a step needs my
credentials or my phone, ask me once with the exact command; otherwise do
it and report. Update the docs FOCUS.md § 7 lists before you finish.
```
