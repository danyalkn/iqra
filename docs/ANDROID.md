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
