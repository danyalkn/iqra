# Screen Time restriction - design and Apple process

Feature: the member picks apps to block. Those apps are shielded until the
member has logged today's Quran in Iqra. The shield comes back at midnight
(profile-local). Opt-in, per device, self-control only.

## Apple process (owner)

Two tiers of the `com.apple.developer.family-controls` entitlement:

- **Development**: just enable the Family Controls capability. Works
  immediately on a physical device with a development profile. Use this to
  build and test everything.
- **Distribution**: required for TestFlight and App Store builds. Must be
  requested from Apple.

Request form: https://developer.apple.com/contact/request/family-controls-distribution

**Filed and approved 2026-10-21 (same day), Request ID GS68KZ6855.**
Apple's email: "assigned to your account, and you can now configure this
capability for eligible apps ... Admins on your team can also use this
capability." The form is no longer per
bundle id (forum posts and older guides describe one request per id). It is
one account-wide request: the page shows the name, email and Team ID
(Qadam Technologies Inc., `69BV989JDV`), the terms, and a "Get the Family
Controls Framework Entitlement" button, with no bundle id or description
fields. "Once assigned to your developer account, you can build apps that
use the capabilities of the Family Controls Framework." Do not file again.
Iqra fits the permitted purpose "offering individuals the ability to manage
their devices to enable focus and productivity".

Notes:

- Submitted as the org's **Account Holder**.
- Four bundle ids need the capability (all four App IDs registered
  2026-10-21):
  - `com.qadamtechnologies.iqra` (the app)
  - `com.qadamtechnologies.iqra.ActivityMonitorExtension`
  - `com.qadamtechnologies.iqra.ShieldConfiguration`
  - `com.qadamtechnologies.iqra.ShieldAction`
- The extension ids are the ones `react-native-device-activity` 0.6.1
  generates: `<ios.bundleIdentifier>.<target folder>`, and its folders are
  `ActivityMonitorExtension`, `ShieldConfiguration`, `ShieldAction`
  (checked in the package source 2026-10-17; `.DeviceActivityMonitor` is
  `expo-app-blocker`'s name, a different library). Ids are case-sensitive.
  The library README lists `.ActivityMonitor`; that is stale. Rechecked
  2026-10-21: `@kingstinct/expo-apple-targets` 0.1.19 (`withWidget.js`)
  builds `<main id>.<folder name>` when the target config sets no
  `bundleIdentifier`, and none of the three do.
- All four must share one App Group (`group.com.qadamtechnologies.iqra`), or provisioning
  fails silently for the missing target.
- After approval: Identifiers -> each of the four App IDs -> Additional
  Capabilities -> enable Family Controls (Distribution). Not yet confirmed
  whether the account-wide grant still needs this per id; check all four.
  Then let EAS regenerate profiles (`eas credentials` or just rebuild).
- Team ID for the config plugin's `appleTeamId`: `69BV989JDV`.

Description of the feature, unused by the form (it had no text fields).
Keep it for any follow-up question from Apple:

> Iqra is a Quran study habit app for a small private study circle,
> published by Qadam Technologies Inc. and distributed through TestFlight.
> Each member logs the Quran they read or memorized each day.
>
> We are adding an opt-in self-control feature: a member chooses the apps
> they find distracting, and those apps stay blocked on their own iPhone
> until they have logged today's reading in Iqra.
>
> How Iqra uses the Screen Time frameworks:
> - FamilyControls: when the member turns the feature on in Settings, Iqra
>   calls AuthorizationCenter.requestAuthorization(for: .individual). It
>   only manages the member's own device. Iqra is not a parental control
>   app and does not monitor or restrict anyone else.
> - FamilyActivityPicker: the member picks apps and categories. Iqra keeps
>   only the opaque selection tokens, in a shared App Group so its
>   extensions can read them. It never learns app names, never reads usage
>   data, and the selection never leaves the device.
> - ManagedSettings: Iqra shields the selected apps and removes the shield
>   as soon as the member logs today's reading.
> - DeviceActivity: a daily schedule starting at local midnight re-applies
>   the shield each new day. No usage thresholds and no activity reports.
> - Shield extensions: a ShieldConfiguration extension shows a custom
>   shield ("Log today's Quran in Iqra to unlock"), and a ShieldAction
>   extension handles its buttons (close, or a local notification that
>   opens Iqra).
>
> The member can pause the block for the rest of the day or turn the
> feature off at any time in Iqra's Settings, and revoking Screen Time
> access in iOS Settings removes it completely. No Screen Time data is sent
> to our servers or any third party.

Timing: Apple says up to a week. 2026 forum reports: a few days to a
month, sometimes silent. After two silent weeks (2026-11-04), open a
Developer Technical Support ticket with the Request ID and Team ID.

Ship TestFlight build 1 WITHOUT the capability. Add it in a later build.

## Technical design

Library: `react-native-device-activity` (Kingstinct). Expo config plugin,
requires a dev build (not Expo Go). Configure with Apple Team ID and the
App Group.

Flow:

1. **Settings -> Focus**: toggle "Block apps until I've logged". On enable,
   request authorization (`.individual`), then present
   `FamilyActivityPicker`. Persist the selection token in the App Group
   (the library handles this) and a boolean in `profiles` or local storage
   (local is enough; this is per device).
2. **Shield logic**: on app launch and on each log save, compute
   `loggedToday` (profile-local date, same rule as the streak code in
   `src/lib/progress.ts`). If enabled and not logged today -> apply shield
   to the selection. If logged -> clear shield.
3. **Midnight re-shield**: a DeviceActivity schedule from 00:00 to 23:59
   local with `intervalDidStart` in the monitor extension re-applying the
   shield. The extension cannot reach Supabase; it just re-shields, and the
   app clears it on next launch after a log. Good enough.
4. **Shield UI**: ShieldConfiguration extension styles the lock screen with
   Paper & Pine colors and copy like "Log today's Quran in Iqra to unlock".
   Buttons can only close or defer; they cannot open Iqra. Workaround: the
   shield posts a local notification deep-linking to `iqra://today`.
5. **Escape hatch**: a "pause for today" button in Settings that clears the
   shield until midnight, because a stuck shield with no escape is how
   people uninstall apps.

Gotchas (from developers who shipped this in 2026):

- Simulator: authorization never completes, picker is empty, extensions
  never run. Physical device only.
- Opaque tokens: the app never learns app names. Show counts ("3 apps").
- iOS 26 phantom threshold events: only matters if you use usage
  thresholds. The design above uses none; prefer schedule + shield on/off.
- Test overnight on a real phone before shipping: the midnight re-shield
  and the "logged at 23:58" edge are the bugs that bite.

## Android

Sideloaded APK, so no Google Play policy review for these permissions.

- Permissions: `PACKAGE_USAGE_STATS` (usage access, Settings deep link),
  `SYSTEM_ALERT_WINDOW` (draw over apps), `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_SPECIAL_USE`.
- A foreground service polls `UsageStatsManager` for the foreground package
  and launches a translucent blocking activity over any listed package when
  not logged today. Re-arm at midnight with `AlarmManager`.
- Android 13+ "restricted settings": sideloaded apps need the user to tap
  "Allow restricted settings" in App info before some permissions can be
  granted. Document this in the install message to the Android member.
- Options: `expo-app-blocker` (covers both platforms) or a ~300 line Expo
  Module in Kotlin. Evaluate `expo-app-blocker` first; write the module
  only if it is stale.

## Data

No server state needed. Per-device: enabled flag, app selection (library
storage), last pause date. If the owner later wants "focus streaks" in
stats, add a `focus_days` table then, not now, and keep it private to the
member: Apple's terms bar sharing device or usage data from the framework
"beyond ... the individual and their device", so showing the circle who
had blocking on, or who paused, is out.

## Progress 2026-10-21 (built; dev build and device checklist next)

Focus is code complete on `main` (7365e6c..dff5882, one concern per
commit; `docs/FOCUS.md` was the plan, `docs/DECISIONS.md` "Focus" has the
owner's answers). Typecheck, lint and expo-doctor clean; local
`expo prebuild --platform ios --clean` gives the app and the three
extensions the Family Controls entitlement and the App Group, `pod
install` passes, the three extension targets compile against the local
iOS 26.5 SDK, and the Android bundle exports (the library is loaded on
iOS only). An independent review ran before the device checklist.
Nothing is on a phone yet: the simulator cannot run Screen Time.

What departs from the FOCUS.md plan, and why (details in the commit
bodies):

- **The shield's primary button.** Apple never let a shield open an app;
  the library's `openApp` does nothing on a device (maintainer, issue 81).
  iOS 26.5 added `ShieldActionResponse.openParentalControlsApp`, which the
  library does not expose yet (upstream PR 97). `patches/
  react-native-device-activity+0.6.1.patch` (patch-package, postinstall)
  adds it to the ShieldAction extension in three lines; iOS 26.5+ gets
  "Open Iqra" with that behavior, older iOS gets "Remind me", a local
  notification with the member's log buttons. The plugin copies the
  extension from node_modules on every prebuild, so the patch is the one
  place that reaches every build.
- **The shield look is written twice** (`updateShieldWithId` for the
  midnight action, `updateShield` for blocks made from the app): a block
  from JS never copies the id-keyed look (Shared.swift `updateShield`).
- **The midnight action carries `neverTriggerBefore`** = the coming
  device midnight: Apple calls `intervalDidStart` immediately when a
  schedule starts inside its interval, which would re-block a member who
  enabled Focus after logging. The schedule is only re-armed when iOS has
  dropped it.
- **Today's list drives Focus both ways**: an entry dated today from the
  web or another phone unlocks once Today sees it, and an empty list for
  today after a landed read (the entry was deleted) brings the block
  back. The plan's "no re-block on delete" went the other way when the
  owner's first device test needed today's two entries out of the way
  (they sat in `public.focus_test_backup`, RLS on, until the test was
  done).
- **Changing apps clears the block list first**: blocking only ever adds.
- **Sign-out, account deletion or another account signing in turns Focus
  off** (review finding: a block only logging can lift must not outlive
  the ability to log).
- **Access revoked while on**: iOS lifts the block itself; the card shows
  the access note with "Allow access" after a restart.
- **Focus needs iOS 18**: the extensions are built for 18.0 and without
  them there is no shield look, buttons or midnight re-block.
- `ios.appleTeamId` is set (expo-apple-targets reads it; the plugin's own
  prop is not forwarded). The `device-activity` scheme from the first
  commit was dropped again with `openApp`.
- At 00:00 iOS runs the monitor only once the phone is in use (Apple
  docs), so an idle phone is re-blocked when next picked up. A log made
  before that first use (a lock-screen button at 06:55) can be followed
  by the re-block; the next log or foreground opens the apps again.
- **Review (Opus, before the device checklist)**: nine confirmed findings,
  all fixed in the three commits after dff5882: sign-out left the block
  running; the picker anchor was unmounted before its debounced final
  selection arrived (every Done could read as Cancel); noteLogged skipped
  the native call when the day was already known; the shield look was
  never refreshed and the midnight action's per-selection keys shadowed
  it; iOS 16.4 to 17 was offered without working extensions; a failed
  pref write could leave a schedule armed while off; a westward zone
  change could block a logged day; the request resolving now counts as
  approved. Accepted: enabling Focus between 23:58 and 00:00 after
  logging blocks until midnight (the mid-day guard's two-minute margin);
  before iOS 26.5 "Remind me" is silent when notifications are off.

Device checklist, with the owner (2026-10-21 evening): step 1 passed on
the owner's iPhone (iOS 26.5) with the dev build: access granted, two
apps picked, both shielded at once with Iqra's title, icon and buttons.
Two things seen: the owner's two entries for the day had to be moved
aside for the shield to show (they sat in `public.focus_test_backup`
and are back; drop that table when done), and after the subtitle was
changed the shield kept showing the old line through an app relaunch:
iOS appears to keep the drawn shield until the block is re-applied
(pause and resume, or the midnight re-block). Unverified; check on the
next session's pass. Steps 2 onward (log to unlock, the shield's "Open
Iqra", airplane mode, the reminder button, pause, turn off, revoke,
overnight) are still to run. The owner parked a follow-up idea: an
unlock goal (pages or "my Sabak") shown as progress on the shield
itself; not building it now.

**iOS 1.0.0 received this JS (2026-10-21, update group 197beb34).** The
owner wanted the circle to see chat pictures before the 1.2.0 build, so
the whole of main went to the TestFlight 1.0.0 build by EAS update
(production channel; app.json held at 1.0.0 for the publish and restored,
the runtime follows the version). Proven first on the simulator's old
dev client (built 2026-10-17, no Screen Time, picker or resizer
modules): launches to sign-in, nothing in Metro's log. On that build
Focus is hidden (its require fails soft, 411d736) and the photo button
says "Update Iqra to send pictures."; pictures from others display.
Android gets nothing (its APK runtime is 1.0.0 too, but it lacks the
push and blur modules the JS now imports; see ANDROID.md).

Next, in order (FOCUS.md § 6 is the detail):

1. ~~Owner: the interactive development build~~ Done 2026-10-21: builds
   5 and 6 (the latter non-interactive, with the picture modules) are on
   the owner's phone; Metro on 8082 serves it. **The production build
   needs the same one-time interactive run** for the extensions' App
   Store profiles: `npx eas-cli@latest build --profile production --platform ios`
   (non-interactive stopped at "Distribution Certificate is not
   validated"); after that, `eas submit --platform ios --latest` is
   non-interactive (ASC key).
2. Check the portal after the build: Family Controls (Distribution) on all
   four App IDs (the owner ticked them 2026-10-21; EAS's capability sync
   has failed silently for others, eas-cli issue 2715).
3. The device checklist in FOCUS.md § 6.4, one step at a time. The
   "Open Iqra" button needs iOS 26.5+; the overnight re-block needs the
   phone used after midnight.
4. `npx eas-cli@latest build --profile production --platform ios --non-interactive`,
   then `npx eas-cli@latest submit --platform ios --latest`; from then on
   iOS JS updates target runtime 1.2.0 (the chat pictures bumped it the
   same evening).

