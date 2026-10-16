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
  requested from Apple and approved per bundle id.

Request form: Apple Developer -> Account -> search "Family Controls" or go
to the "Request the Family Controls (Distribution) capability" page. Notes:

- Submit as the org's **Account Holder**. Admins get rejected or ignored.
- One request per bundle id. Four total:
  - `com.qadamtechnologies.iqra` (the app)
  - `com.qadamtechnologies.iqra.DeviceActivityMonitor`
  - `com.qadamtechnologies.iqra.ShieldConfiguration`
  - `com.qadamtechnologies.iqra.ShieldAction`
- All four must share one App Group (`group.com.qadamtechnologies.iqra`), or provisioning
  fails silently for the missing target.
- After approval: Identifiers -> each App ID -> Additional Capabilities ->
  enable Family Controls (Distribution). Then let EAS regenerate profiles
  (`eas credentials` or just rebuild).

Suggested description (adapt, keep it specific):

> Iqra is a Quran reading habit tracker for a small private study circle.
> Users opt in to select apps with FamilyActivityPicker. The app applies a
> ManagedSettings shield to those apps until the user logs their daily
> reading in Iqra, and uses a DeviceActivity schedule to re-apply the shield
> each day. Authorization is `.individual`, for the user's own device only.
> The app never accesses the identity of the selected apps; it only stores
> the opaque tokens. No parental or remote monitoring.

Timing: Apple says up to a week. 2026 forum reports: a few days to a
month, sometimes silent. After two silent weeks, open a Developer
Technical Support ticket referencing the request.

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
stats, add a `focus_days` table then, not now.
