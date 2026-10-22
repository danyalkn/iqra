# Android handoff - push notifications and the glass tab bar

Written 2026-10-20 for a fresh session and the owner. Two jobs, both
Android only, shipped together in one Android build:

1. **Android push** so the Android member can move off the web PWA and
   onto the app (owner request 2026-10-20). This is the priority.
2. **A Liquid Glass style tab bar on Android** (owner request 2026-10-20).
   iOS keeps the real system glass bar untouched.

Read `CLAUDE.md`, then this file, then `docs/DECISIONS.md` ("Logging",
the tab bar lines under the design section), `docs/PUSH.md`,
`docs/PHASE3.md` "Progress and decisions made while building", and
`docs/NEXT-SESSION.md` "State of play" (how builds and EAS Update work).
The SDK 58 docs and the `node_modules` types are the truth for every Expo
API; fetch `https://docs.expo.dev/versions/v58.0.0/` pages before writing
code.

## State of play (checked 2026-10-20)

- iOS 1.0.0 is on TestFlight. One Android APK (1.0.0, `preview` profile,
  arm64-v8a, EAS-held keystore) was sent to the Android member, but **he
  still uses the PWA because the APK cannot get push.** No Firebase
  project exists yet, there is no `google-services.json`, and app.json has
  no `android.googleServicesFile`. Without them
  `getExpoPushTokenAsync` fails on Android, so the Profile toggle shows
  "Couldn't reach the notification service" there.
- **The push code is already Android-ready**, so expect config and
  testing, not a rewrite:
  - `src/push/register.ts` creates channel `iqra` (`AndroidImportance.MAX`)
    before the permission prompt (Android 13 shows none until a channel
    exists), then stores `{ expo, platform: "android", device }` in
    `push_subscriptions`.
  - `src/push/task.ts` is the Android background task that runs the
    reminder action buttons headless (imported first from `index.js`).
    **Never tested on a real Android device** (PHASE4.md). The emulator
    pass on 2026-10-17 covered offline logging, not push.
  - `supabase/functions/send-push` already sends Expo rows with
    `channelId: "iqra"`, `priority: "high"`, `categoryId`, and Android
    `tag` replacement. Expo's service routes to FCM once EAS holds the FCM
    V1 key. No edge function or SQL change is expected.
  - `categories.ts`: Android shows at most three action buttons, already
    handled.
- The Android tab bar today is the system Material 3 bar from
  `NativeTabs` (`src/app/(tabs)/_layout.tsx`), styled only through its
  props (`indicatorColor`, `rippleColor` and friends).
- JS reaches Android by `eas update --channel preview --platform android`.
  `runtimeVersion` is `{ policy: "appVersion" }`.

## Versioning: why Android goes to 1.1.0 on its own

Both jobs change native code: `google-services.json` is baked into the
binary, and `expo-blur` is a native module. A native change needs a new
build and a new runtime version, or an EAS update made for the new binary
could reach the old one and crash it.

**Do not bump the top-level `version`.** That would move iOS to runtime
1.1.0 too, and the TestFlight 1.0.0 build would stop receiving updates
until a new iOS build ships (the iOS 1.1.0 build is reserved for Screen
Time). Instead set **`android.version: "1.1.0"`** in app.json. The SDK 58
app config docs say `android.version` takes precedence over the root
`version` and that `android.runtimeVersion` can override per platform.
Before building, confirm that the `appVersion` policy picks up
`android.version` (read the docs or run
`npx expo config --type public` and check what EAS reports as the Android
runtime). If it does not, set `android.runtimeVersion: "1.1.0"` as well.

After the new APK is out, Android updates go to runtime 1.1.0, so the
1.0.0 APK stops getting JS. That is fine: the Android member is the only
Android install and he moves to 1.1.0 as part of this work.

`preview` has no `autoIncrement`. Check that the new APK's `versionCode`
is not lower than the installed one (EAS reports it; `appVersionSource`
is `remote`). A lower code refuses to install over the old APK. An
uninstall would also wipe his saved session and outbox. If needed, add
`autoIncrement: true` to `preview` in its own commit.

**One build for both jobs**, so the member sideloads once. If the glass
bar is not done and verified in the same session, ship push alone as
1.1.0 and give the glass bar 1.2.0 later. Do not hold push for it.

## 1. Android push

### Owner steps (needs the owner's Google login, about 10 minutes)

Give the owner these one at a time and wait for each:

1. Firebase console (console.firebase.google.com): create a project
   "Iqra" (Analytics off is fine).
2. Add an Android app with package **`com.qadamtechnologies.iqra`**. No
   SHA-1 is needed for FCM. Download **`google-services.json`**.
3. Project settings > Service accounts > **Generate new private key**.
   This JSON is a secret. It goes to EAS only, never into the repo.
4. Upload the service account key to EAS: expo.dev > project iqra >
   Credentials > Android > `com.qadamtechnologies.iqra` > FCM V1 service
   account key > Add. Or `npx eas-cli@latest credentials` > Android >
   Google Service Account > FCM V1 > Upload, interactively (the CLI needs
   a TTY, so the owner runs it, not the agent).
5. Hand `google-services.json` to the agent (drop it in the repo root).

Docs: https://docs.expo.dev/push-notifications/fcm-credentials.md. Their
note: if `client.api_key.current_key` in `google-services.json` is
restricted in Google Cloud, it must allow the FCM Registration API and
the Firebase Installations API. Otherwise the token request returns 403
and no token ever arrives. A new project's key is unrestricted, so this
only matters if it fails.

### Agent steps

1. `google-services.json` at the repo root, committed. The Expo docs say
   it holds only public identifiers, and the repo is public; that is
   acceptable. Add a `.gitignore` line for the service account key
   pattern (`*firebase-adminsdk*.json`) in case it lands in the folder.
2. app.json: `android.googleServicesFile: "./google-services.json"` and
   `android.version: "1.1.0"` (see Versioning). Run `npx expo-doctor`.
3. Build the APK (see "Build and ship" below), install it on an
   **Android emulator with a Google Play system image** (FCM needs Google
   Play services; a plain AOSP image gets no token). Test with a
   throwaway account in the Demo Circle, as before
   (`docs/NEXT-SESSION.md`, memory "Simulator testing"), never the real
   circle.
4. Checklist, all on the emulator first:
   - Profile > Notifications on: Android 13+ prompt appears, a row with
     `"platform": "android"` lands in `push_subscriptions`.
   - `select public.send_push(array['<uid>']::uuid[],
     jsonb_build_object('title','Iqra','body','Test','url','/chat'));`
     arrives as a heads-up banner with sound. A tap opens Chat.
   - A reading reminder with `'category','logReading'` shows its buttons.
     "Log 1 page" with the app **killed** writes exactly one row
     (`src/push/task.ts`, first ever real run). Also from the background.
     Same for `logHifz`.
   - `tag` replacement: two pushes with the same tag show one
     notification.
   - Toggle off: the row is gone. Sign out: the row is gone.
   - The 8 PM revision nudge (a local notification) uses channel `iqra`.
   - Diagnostics if nothing arrives: `select * from net._http_response
     order by created desc limit 5` (the edge function's reply, including
     its `errors` array). "sent" there means accepted by Expo, not
     delivered. FCM credential problems show in Expo **receipts**, so
     look them up with the ticket ids:
     `POST https://exp.host/--/api/v2/push/getReceipts`
     `{"ids":[...]}`. An `InvalidCredentials` receipt means the FCM V1 key
     upload is wrong or missing.

### Moving the Android member over

Do these with the owner. Each step that touches the member's own phone
or his rows needs the owner's go-ahead.

1. The owner sends him the new APK link. It installs **over** the old APK
   (same EAS keystore), so his sign-in and any offline queue survive.
   Android warns about unknown sources; that is expected.
2. He opens Iqra, signs in with the **same email** he uses on the PWA (his
   data, reminders and day reminders are all server-side, so nothing
   needs moving), and turns on Profile > Notifications.
3. The agent checks for his `platform: "android"` row and sends him one
   test push (with the owner's OK, since it is a real member).
4. **Remove his web push rows** so he does not get every push twice:
   `delete from push_subscriptions where user_id = '<his uid>' and
   subscription ? 'endpoint';`. Run it only after his Android push is
   confirmed, with the owner's OK. Then he removes the PWA from his home
   screen.
5. Tell him, via the owner: if reminders arrive late, set Iqra's battery
   use to "Unrestricted" in Android settings (Samsung, Xiaomi and others
   delay background apps). Keep the copy free of em dashes.
6. Then update HANDOFF Phase 5: the Android member has moved.

## 2. Glass tab bar on Android

### Goal

An Android tab bar that looks like the iOS 26 Liquid Glass bar: it floats
above the bottom edge with fully rounded ends, the content scrolls behind
it frosted, with a soft "Paper & Pine" tint, a thin bright edge and soft
depth. Selected tab is emerald (`c.accent`) with the `c.accentTint` pill
behind it, as today. **iOS does not change**: it keeps `NativeTabs` and
the real system glass.

It is an imitation. Android has no glass material, so no lensing or light
bending. Frosted, tinted and floating is the target.

### Decision to record

`docs/HANDOFF.md` says "the system tab bar is not to be restyled" and
DECISIONS says "native tab bar". The owner overrode that **for Android
only** on 2026-10-20. When the bar lands, add a dated line to
`docs/DECISIONS.md`: iOS keeps the system bar, Android gets a custom glass
bar because Material has no glass. Also fix the header comment in
`src/app/(tabs)/_layout.tsx`.

### Design (verify each API against the SDK 58 docs first)

- **Route split.** Keep `src/app/(tabs)/_layout.tsx` (NativeTabs, iOS)
  and add `src/app/(tabs)/_layout.android.tsx`. Expo Router platform
  files need the base file to exist, which it does. Confirm in the Expo
  Router docs that a platform-specific `_layout` is supported in SDK 58.
  If not, branch on `Platform.OS` inside one layout and keep the Android
  bar in its own `.android.tsx` component file.
- **Tabs.** Use `expo-router/ui` headless tabs (`Tabs`, `TabSlot`,
  `TabList`, `TabTrigger`, already in `node_modules/expo-router/build/ui`;
  no new dependency). Same five routes, order and labels: Today, Feed,
  Chat, Insights, Profile. `@react-navigation/bottom-tabs` is not
  installed, and there is no need to add it.
- **Blur.** `npx expo install expo-blur`. On Android a `BlurView` only
  blurs what is inside a `BlurTargetView` whose ref it gets
  (`blurTarget`, `blurMethod="dimezisBlurView"`; see "Android support" on
  the v58 blur-view page). So wrap `TabSlot` in one `BlurTargetView` and
  put the bar's `BlurView` over it, outside the target. Read the page's
  known issues and performance notes.
- **Keep `expo-blur` out of the iOS bundle.** The TestFlight 1.0.0
  binary has no ExpoBlur native module. If iOS JS imports `expo-blur`,
  the next iOS EAS update crashes on launch. Corrected 2026-10-20 after
  checking the export source map: route `.android.tsx` files ARE bundled
  on iOS (expo-router's route context takes every platform file and only
  ignores the route there), so "import it only from `.android.tsx`
  files" is not enough. What keeps it out: `_layout.android.tsx` imports
  the bar by the bare specifier `@/components/tabBar/AndroidTabs`, which
  Metro resolves to the blur-free `AndroidTabs.tsx` fallback on iOS and
  to `AndroidTabs.android.tsx` on Android. Rule: import `expo-blur` only
  from a non-route `.android.tsx` component reached through a bare
  specifier with a blur-free sibling; never from a route file and never
  by the explicit `.android` path. Proof stays
  `npx expo export --platform ios --output-dir <scratch>` and
  `grep -c -a ExpoBlur` on the `.hbc` (must print 0; `NativeTabs` prints
  3 there, which shows the grep sees strings).
- **Icons.** NativeTabs takes Material Symbols names (`md=`). A custom bar
  draws its own icons. Decided 2026-10-20: Lucide (`lucide-react-native`,
  already the in-screen icon set). `expo-symbols` does render Material
  Symbols on Android in SDK 58, but it loads a multi-megabyte font with
  `expo-font` after mount, so the bar would render blank on every cold
  start and every Android update would carry the font. Lucide has no
  filled variants: the selected glyph gets a faint accent fill inside its
  outline plus a heavier stroke.
- **Look.** Tokens from `src/constants/theme.ts` only. Bar about 64 tall,
  16 side margin, `insets.bottom + 8` from the bottom (the gesture bar),
  radius full. Tint: `c.surface` at roughly 70 percent opacity over the
  blur in light, a little less in dark. Hairline top edge brighter than
  `c.border`, soft shadow (Android `elevation` plus a shadow color).
  Tune on the emulator in both themes.
- **Behaviour the system bar gave for free, now ours:**
  - Accessibility: `accessibilityRole="tab"`, `accessibilityState={{
    selected }}`, labels, 48dp minimum touch targets, TalkBack order.
  - Hide the bar while the keyboard is open (Chat especially; Android
    resizes the window, so a floating bar would ride up on the
    keyboard). `react-native-keyboard-controller` is installed. Keep the
    chat's "Hide keyboard" chevron (DECISIONS 2026-10-18).
  - Android back button: match what NativeTabs does now (check on the
    1.0.0 APK before replacing it).
  - The bar never minimises (DECISIONS 2026-10-18 applies here too).
  - Deep links from pushes (`toNativeHref`) still land on the right tab.
- **Bottom clearance.** Content now runs behind the bar, so every screen
  that clears the system bar on Android must clear the floating bar
  instead. One shared helper (for example `useTabBarClearance()` in
  `src/components/`, not `src/lib`) returning bar height + gap +
  `insets.bottom` on Android. Known places: `listBottomClearance` and
  `fabBottomOffset` in `src/app/(tabs)/today.tsx` (~140-165, FAB and last
  row), `listBottomClearance` in `feed.tsx`, the `paddingBottom` in
  `profile.tsx` (~172), `ANDROID_BOTTOM_PADDING` and the composer in
  `chat.tsx` (~48, ~752), and Insights (`stats.tsx`). Grep for
  `insets.bottom` and `Platform.OS` to catch the rest. iOS values must not
  change.
- **Performance fallback.** Live blur can drop frames on cheap phones.
  Scroll Feed and Insights on the emulator with the GPU profile bars on.
  If it stutters, or if the member's phone is weak, fall back to the same
  bar with no blur: a solid tint with higher opacity. A single constant
  should switch between the two.

### Testing

Independent Opus review of the diff before device testing, as every
phase so far. Emulator, release APK, both themes: each tab, FAB and last
rows clear the bar, Chat with the keyboard up, back button, TalkBack, a
push deep link into each tab, dark mode. An `expo export` check that the
iOS bundle has no ExpoBlur. Then the member's phone after he installs.

## Build and ship

1. All code in, `npx tsc --noEmit`, `npx expo lint`, `npx expo-doctor`
   clean.
2. `npx eas-cli@latest build --profile preview --platform android
   --non-interactive` (the keystore is already on EAS). Confirm the
   runtime version EAS prints is 1.1.0 and the versionCode is not lower
   than the old APK's.
3. Emulator checklist above, then the owner sends the expo.dev link to
   the member.
4. From then on, Android JS updates:
   `npx eas-cli@latest update --channel preview --environment preview --platform android --message "..." --non-interactive`
   iOS updates are unchanged and stay on runtime 1.0.0.
5. Update `docs/HANDOFF.md` (Status table and working notes) and
   `docs/NEXT-SESSION.md` owner check 5. Commit per concern: deps,
   config, tab bar, clearance helper, docs.

## Progress 2026-10-20 (session 1: the tab bar landed, push waits on Firebase)

Job 2 is done in `main` and emulator-verified; job 1 waits on the owner's
Firebase steps (none done yet). Nothing has shipped: the 1.1.0 APK is not
built, and Android JS updates must not be sent (the only Android install
is the member's 1.0.0 APK, which stays on runtime 1.0.0).

Commits, one concern each: expo-blur dep (8e93e7e), `android.version`
1.1.0 (9a9e248; resolver confirms Android 1.1.0, iOS 1.0.0), preview
`autoIncrement` (e0a3ee6; remote versionCode was 1), the bar component
(38c91c0), the clearance hook (258100d), the route switch (823524d),
re-tap scroll to top (52ef916), DECISIONS (a99e3f9), docs (9918503),
eager mounting, glyphs and the chat keyboard fix (the three after).

What changed against section 2 above, and why:

- **Bundling fact corrected** (see the expo-blur bullet): route
  `.android.tsx` files are bundled on iOS; the blur-free
  `AndroidTabs.tsx` fallback is load-bearing.
- **Icons: Lucide**, `ChartNoAxesColumn` for Insights, faint accent fill
  in the selected glyph except Users (open paths fill into wedges).
- **Blur only on Android 12+ (`LIVE_BLUR`)**, gated in JS: expo-blur's own
  SDK fallback is defeated by prop order (review). Wash alphas are 0.34
  light / 0.27 dark because expo-blur's tint is a colour layer of its own
  (review); the emulator measured about 30 percent (light) and 35 percent
  (dark) of the content showing through, on target.
- **Every tab mounts at launch** (`renderEveryTab`), as NativeTabs did;
  the lazy slot left the old screen on show for 2 to 3 s on a first visit.
- **Re-tap scrolls to the top** on Today, Feed, Insights, Profile
  (`useReselectScrollToTop`; iOS gets an inert ref). Chat excluded.
- **Chat keyboard on Android**: keyboard-controller's KeyboardAvoidingView
  put the field under the keyboard in two runs (its measured frame came
  out 112 dp short; the probe showed every input right and the result
  wrong; not reproducible on demand). Android now pads from the keyboard
  height alone (`KeyboardSpace` in chat.tsx); iOS path unchanged. The old
  Android config (offset 0, padding 8) was never emulator-verified either.
- `expo-doctor`: five patch-level updates listed (expo, expo-router,
  expo-font, expo-image, @expo/ui). Left alone so the JS iOS receives
  stays what was reviewed; bump them in a separate commit if wanted.

Emulator run (Sonnet agent, AVD `iqra-play`, API 35 Play image, debug
build + Metro, throwaway in the Demo Circle, deleted after): bar look,
TalkBack attributes (role tab, selected, labels, 76x51 dp items),
clearance on every screen including the FAB fan-out, keyboard hide, back
button (Feed to Today, Today exits), the three push deep links, dark mode,
sign-out, re-tap scroll: pass. gfxinfo was 97 to 99 percent janky on
every screen including Journal with no bar, so the emulator's software
renderer, not the bar; judge frame rate on the member's phone. Screenshots
in the session scratchpad only.

Emulator notes for next time: the owner's `p9pro` AVD was 99 percent
full; Iqra has its own `iqra-play` (8 GB data). A headless emulator from
another project (`emulator-5562`) is often attached: always pass the
serial. The emulator crashed twice under host load (the review workflow,
an export and gradle were running at once); run it alone. `supabase db
query` prints only the last statement's rows.

Superseded the same evening: a second session did Firebase, push and
the build in parallel (next section), and session 1 then verified build 4.
See "Build 4 verified" below for what remains.

## Progress 2026-10-20 (session 2: push works, 1.1.0 APK built)

Firebase is done. Project `iqra-b9e95` sits under the owner's Workspace
organization (theqadamapp.com). That org blocks service account key
downloads by default, so the owner overrode
`iam.managed.disableServiceAccountKeyCreation` for the Iqra project only
(Cloud console > IAM > Organization policies, "Override parent's policy",
enforcement off). The org itself is still protected. The FCM V1 key is on
EAS (expo.dev > iqra > Credentials > Android > FCM V1). The local copy
was deleted. `google-services.json` and `googleServicesFile` landed in
b114e2d and the `.gitignore` line in ed42577.

Builds (`preview`, EAS): versionCode 2 died with "Gradle build daemon
disappeared", and versionCode 3 (from ed42577) passed. A local release
build failed the same way with `Metaspace`: the generated
`gradle.properties` caps Gradle at `-Xmx2048m -XX:MaxMetaspaceSize=512m`.
If EAS keeps failing like this, raise `org.gradle.jvmargs` through
`expo-build-properties` or a small config plugin. **versionCode 4**
(d4a6d388, from 14d5cf0, runtime 1.1.0) is the APK for the member. It
has the tab bar fixes that 3 lacks. Do not send 3.

**The emulator cannot test push on an EAS APK.** `register.ts` returns
"unsupported" when `Device.isDevice` is false, and it is false on every
emulator. The checklist ran on a local release build
(`expo run:android --variant release`) with the line
`node_modules/expo-device/build/Device.js` line 8 temporarily set to
`isDevice = true` and restored right after. Same native config, same
push JS as build 4.

Results (`iqra-play`, throwaway in the Demo Circle, deleted after):

- Token and row: FCM issues a token, and a `platform: "android"` row lands
  in `push_subscriptions`. Toggle off deletes it, toggle on restores it,
  sign-out deletes it. Pass.
- `send_push` to the edge function to Expo to FCM: heads-up with sound,
  channel `iqra` at importance 5, emerald accent. Pass.
- Tap with the app in the background, or after a swipe-away (task gone,
  process dead): lands on the push's `url` (Chat). Pass.
- **Gap:** tap after the system killed the process with the task still in
  Recents (`am kill`, what low-memory killing does) lands on **Today**,
  not the push's `url`. Android recreates MainActivity from its old
  LAUNCHER intent, so the FCM extras never reach expo-notifications. Not
  fixed. Taps still open the app.
- Tag replacement: two pushes with `tag: reminder` leave one notification.
  Pass.
- **Finding: no log buttons on Android while Iqra is closed or in the
  background.** Expo's push service sends FCM *notification* messages
  (`title`/`body`/`channelId` set), which Android draws itself, without
  the category. The expo-notifications source says the only presented
  data-only path "can not be triggered by expo push service, only when
  using FCM directly" (`ExpoHandlingDelegate.kt`). A data-only test via
  Expo woke the app headless (the task ran) but showed nothing. Buttons
  appear only on pushes received while the app is open: Iqra's handler
  draws those, with all three buttons. The owner decides whether that is
  fine or worth the data-only redesign (see the summary in the session;
  options: accept, or send Android reminders data-only and have
  `task.ts` present them locally with the category, trading delivery
  reliability on aggressive OEM battery savers).
- Headless log, first real run of `task.ts`: with a button notification in
  the tray and the app killed, "Log 1 page" wrote exactly one row
  (reading, 1 page). The app stayed in the background and the
  confirmation ("Logged 1 page. Streak: 1 day.") showed. Pass.
- The revision nudge and the confirmations post on channel `iqra` (code).
- Not run: `logHifz` buttons (same path as `logReading`), Expo receipts
  (every ticket and receipt came back `ok`).

Remaining: the member's move (owner sends the build 4 link, then
"Moving the Android member over" above; the owner has not yet given his
email or OK'd a test push), the owner's call on Android log buttons, and
the HANDOFF status line once he has moved.

## Build 4 verified (2026-10-20, session 1, release binary)

Offline, from the EAS artifact (`eas build:download --build-id
d4a6d388-9028-492c-a358-1fef13c19a79`): `versionCode 4`, `versionName
1.1.0`, arm64-v8a only, Firebase `project_id iqra-b9e95` and
`gcm_defaultSenderId 285973472160` in the resources, and the Hermes bundle
carries the tab bar fixes (`AndroidKeyboardPad`, `renderEveryTab`,
`ChartNoAxesColumn`, `useReselectScrollToTop`) plus `ExpoBlur`.

On `iqra-play` (API 35), build 4 installed over 3, signed in with the push
session's throwaway (deleted after, zero rows confirmed by both sessions):

- Cold launch, first tap on Profile: Profile is in the first dump 0.3 s
  after the tap (eager mounting holds in release).
- Chat keyboard: field bottom 1818 px against the IME top at 1848 px, a
  10 dp gap, "Hide keyboard" chevron beside the field.
- Re-tap on a scrolled Profile returns the title to y 240. Back from Feed
  selects Today; back from Today goes to the launcher with the process
  alive; reopening shows Today.
- Light and dark Today, dark Feed with a chip frosted under the bar, the
  three-bar Insights glyph: as designed.

Push could not be re-run on build 4 itself (emulator gate on
`Device.isDevice`, previous section); the push JS and native config are
the same as the patched local build the checklist ran on.

**What the owner still decides or does** (nothing ships until then):

1. Which member is on Android (the push rows suggest saim.rasheed or
   amanmarkar), and send him the build 4 install page:
   https://expo.dev/accounts/danyal0726/projects/iqra/builds/d4a6d388-9028-492c-a358-1fef13c19a79
   (installs over the 1.0.0 APK; Android warns about unknown sources).
2. He signs in with his PWA email and turns on Profile > Notifications; an
   agent then checks for his `platform: "android"` row.
3. OK for one test push to him (a real member).
4. OK to delete his web push rows (`subscription ? 'endpoint'`) once the
   Android push landed; then he removes the PWA from his home screen and
   sets Iqra's battery use to Unrestricted if reminders run late.
5. The call on Android log buttons (previous section): accept that
   background reminders have no "Log 1 page" buttons on Android, or ask
   for the data-only redesign.
6. Then update HANDOFF Phase 5 (the member has moved) and NEXT-SESSION
   owner check 5. From then on Android JS updates go to runtime 1.1.0:
   `npx eas-cli@latest update --channel preview --environment preview --platform android --message "..." --non-interactive`.
   Send one right after he installs: build 4 (14d5cf0) predates the
   reading bookmark copy fix (41b3c69).

## iOS received this JS (2026-10-20)

The iOS production update for the bookmark copy fix (group 16109ae5,
runtime 1.0.0, from 41b3c69) was the first iOS update since 3a70e96, so
it carried every commit in this file to the TestFlight build too. Checked
first, per the expo-blur rule: `grep -c -a ExpoBlur` on the iOS export
printed 0 (`NativeTabs` 3). The iOS-side changes are the inert re-tap ref
and the shared clearance hook; Today, the tab bar and the log sheet ran
normally on the iOS simulator at that commit. No Android update was sent.

## Build 6 verified (2026-10-21, 1.2.0, the APK for the member)

Build 4 is superseded (1.1.0 runtime, no picture modules): the member
gets **build df7fe5f5, versionCode 6, version 1.2.0** (preview profile,
arm64, the same keystore, so it installs over his APK). Its page:
https://expo.dev/accounts/danyal0726/projects/iqra/builds/df7fe5f5-a37d-49ad-932d-a43c7c97fc13
It carries everything iOS 1.2.0 has except Focus, whose Settings card
says "Coming soon to Android" with no switch (owner's choice over
hiding it). The first attempt (08ca7d61) died in Gradle's Kotlin compile
("daemon disappeared", memory); `plugins/withGradleMemory.js` now writes
a 4 GB heap and 1.5 GB Metaspace into gradle.properties (d81f4b4).

Emulator run (Sonnet agent, AVD `iqra-play`, throwaway account in the
Demo Circle, deleted after with zero rows left; screenshots were in the
session's scratchpad): install over build 4, sign-up without email
confirmation, onboarding, 1 page logged and on the server; a picture
with a caption sent from Android's photo picker (41 KB for the flat app
icon, 73 KB for a 6016 px wallpaper, both 1600 px after the resize,
object and row correct), full screen on tap, Reply and Copy on the
captioned picture, no Copy on a caption-less one, the reply bar reading
"Photo", both pictures back after a force-stop, the Settings card as
designed, zero FATAL or missing-module lines in logcat. Chat pictures
were tested against the Demo Circle only; nothing reached the real one.

Seen on this run and fixed the same evening (see "Keyboard and layout
pass" below): in the Log Reading sheet the numeric keyboard covered
"Save entry" until the keyboard's check key hid it; the long-press menu
on an own message near the bottom opened over the picture instead of
beside it. Library warnings (`ExpoModulesV2` Enumerable,
`OnBackInvokedCallback`) are harmless; predictive back is off on
purpose.

Still with the owner (unchanged from "Moving the Android member over"):
send him the build 6 page instead of build 4's, his email, the OK for a
test push, and the web push row cleanup.

## Keyboard and layout pass (2026-10-21, both platforms)

Owner request after the build 6 run: fix the two items above and every
other visual or keyboard bug, both platforms. 24 commits, e41d9da..06474a2,
JS only (no native change, so both 1.2.0 binaries can take it by EAS
Update; **nothing has been published yet**). Verified on the `iqra-play`
emulator (debug build on Metro) and the iPhone 16 Pro simulator (fresh
dev build of main), then swept screen by screen by two Sonnet agents
(light, dark, large text, a smaller display size) whose findings were
fixed too. Throwaway account in the Demo Circle, deleted after: zero
rows in any public table, its one picture deleted from Storage as its
owner.

What was wrong and what changed (the commit bodies have the detail):

- **No sheet moved for the Android keyboard.** keyboard-controller sets
  every Modal window to adjustNothing and the Sheet's RN
  KeyboardAvoidingView had no Android behaviour. `Sheet` now pads its
  panel by keyboard-controller's keyboard height on both platforms
  (padding, not lifting, so the paper runs behind iOS 26's translucent
  keyboard), drops a keyboard left up by a field outside the sheet when
  it opens, and lowers its own field's keyboard as it closes.
- **iOS never scrolls a focused field into view.** New `SheetScroll`
  (src/components/ui/SheetScroll.tsx) does, on keyboard settle, on focus
  and as a note grows; `Input` calls it through context. Every sheet form
  uses it, with `SheetFooter` pinning the error line and actions under
  the scroll, and the log and reminder sheets pin their title row above
  it. Decided against keyboard-controller's KeyboardAwareScrollView there
  (it measures against the keyboard and adds its own space, which
  double-counts inside a padded sheet).
- **Sign-in, sign-up and onboarding** used RN's KeyboardAvoidingView, a
  no-op on Android (the window never resizes under KeyboardProvider):
  now keyboard-controller's KeyboardAwareScrollView on both platforms.
  Return moves field to field and the last field submits (also Reset
  password).
- **Chat long-press menu over the picture:** MessageRow measured the
  bubble on RN's keyboardDidHide, which fires as the Android keyboard
  starts down; it now waits for `KeyboardController.dismiss()`. The
  overlay is bounded by the safe area and stacks pill and menu above a
  bubble near the composer. Photo viewer: drops the keyboard, light
  status bar, runs under the navigation bar.
- **iOS tab screens report the tab bar as safe area** (NativeTabs gives
  each its own SafeAreaProvider: 83 pt bottom, not 34), so every sheet
  had a 49 pt empty band and the chat menu stopped short.
  `useWindowInsets` (launch metrics on iOS) feeds Sheet, ActionOverlay
  and ImageViewer.
- **Android drew some row labels a hair narrower than it measured them**
  and wrapped the last word out of sight ("Your week" as "Your", "juz
  this week so far" without "far"). It lives in React Native's prebuilt
  Android text code, so the at-risk labels take their row's free width
  instead (flex 1 / flexGrow 1). Watch for it in new rows: a multi-word
  label sitting at its own width in a row is the risk.
- Smaller: pages read takes "1,5" and Arabic digits; the time zone
  picker shows real offsets on iOS (Intl's shortOffset said "GMT");
  avatars read "AD" not "A("; dark sheets get a hairline edge; the
  Android switch uses Material's colour roles; 44 pt touch areas on the
  small links; Insights pads its root for the status bar like the other
  tabs and says "1 day" / "1 entry"; Feed's delete button moved to the
  title line so my rows show the whole surah; settings row notes wrap;
  the profile card drops the types line when it only repeats "Reading";
  text buttons label themselves (RN Android kept "busy" in TalkBack).
- **Not visual, found on the way:** `getMyMembership` (src/lib/data.ts)
  and chat's copy read the earliest-joined `group_members` row without
  filtering to the user, so every member who joined after the owner got
  the owner's role and saw the owner-only "Add member" search (the
  server refused it). Both now filter on the session's user id; the web
  repo needs the same filter (HANDOFF working notes).

Left as is, on purpose:

- iOS's own "Use Strong Password?" panel on sign-up is taller than the
  keyboard and overlaps the bottom 15 pt of Create account; the button
  still works and the normal keyboard leaves it clear.
- The chat overlay dims the pressed bubble with everything else (web
  parity); the pill and menu sit beside it.
- With the largest text sizes and the keyboard up, the log sheet's form
  scrolls inside a short space; nothing is unreachable.
- Once on iOS a long-press opened the menu for the neighbouring message
  right after the chat loaded; it did not happen again in six more
  tries (keyboard up and down).

To ship it: `npx eas-cli@latest update --channel production --environment production --platform ios --message "..." --non-interactive`
for iOS 1.2.0, and the same with `--channel preview --environment preview --platform android`
for build 6 (both runtime 1.2.0). Owner's call when.

## Kickoff brief for the next session (paste as the first message)

```
I'm continuing the Iqra native app (Expo SDK 58, Expo Router, React 19,
RN 0.88). iOS 1.0.0 is on TestFlight; one Android APK (1.0.0) is out but
has no push, so our Android member still uses the web PWA.

Read in this order before touching anything: CLAUDE.md, docs/ANDROID.md
(this handoff), docs/DECISIONS.md, docs/PUSH.md, docs/PHASE3.md
"Progress and decisions made while building", docs/NEXT-SESSION.md
"State of play". The SDK 58 docs and node_modules types are the truth for
every Expo API; fetch them before writing code.

Two Android-only jobs, shipped in one Android 1.1.0 APK:
1. Android push (priority). The push code is already Android-ready; what
   is missing is Firebase: walk me through the owner steps in
   docs/ANDROID.md one at a time, then wire google-services.json, build,
   and run the emulator checklist (Google Play image, throwaway account
   in the Demo Circle). Then help me move the Android member over,
   including deleting his web push rows once his Android push works.
2. A Liquid Glass style tab bar on Android only (floating, frosted with
   expo-blur, Paper & Pine tint). iOS keeps NativeTabs untouched. I
   approved this Android exception to the "don't restyle the tab bar"
   rule; record it in DECISIONS.md when it lands.

Versioning matters: set android.version to 1.1.0, never the top-level
version, so iOS keeps getting EAS updates on 1.0.0. Keep expo-blur out of
the iOS bundle (.android.tsx only) and prove it with an expo export grep.
If the tab bar is not done and verified, ship push alone and do not hold
it.

Rules: single thread of decisions; Sonnet or Opus subagents for research,
review and scoped fixes, never Haiku, and look over their outcomes; an
independent Opus review before device testing. src/lib stays RN-free. No
em dashes anywhere. Commit per concern with a body that says why; do not
push unless I ask. npx tsc --noEmit and npx expo lint before calling
anything done. Anything that touches a real member (test pushes, deleting
his rows) needs my OK first. If a step needs my Google login or my phone,
ask me once; otherwise do it and report.
```
