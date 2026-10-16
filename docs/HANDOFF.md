# Iqra native migration - handoff

Written 2026-10-16 by the Claude session that set this repo up, for the
next Claude session (and the owner) to pick up the migration. Read
`CLAUDE.md` and `docs/DECISIONS.md` first. This file is the plan and the
state of play. Keep the **Status** section current as phases complete.

## Why this repo exists

The owner was accepted into the Apple Developer Program (organization
account) and wants the web PWA shipped as a real iOS app on TestFlight,
plus an Android APK sideloaded to the one Android member. New feature on
top: **screen-time restriction** (shield chosen apps until today's Quran is
logged). Decision made with the owner: new repo, Expo, freeze the PWA, this
repo owns Supabase.

## Stack (decided, do not relitigate)

| Concern | Choice | Why |
|---|---|---|
| Framework | Expo SDK 58, Expo Router, React Native 0.88, React 19 | One codebase, shared logic drops in, EAS builds both platforms |
| Builds | EAS Build + EAS Update | TestFlight and APK from one command; JS fixes over the air |
| Backend | Existing Supabase project, unchanged | Zero backend rewrite. Schema, RLS, cron jobs, edge function all stay |
| Auth | supabase-js email + password, session in `expo-secure-store` | Same accounts as the web app |
| Data | supabase-js directly from the client (replaces Next server components) | The queries in `reference/web-pwa/data.ts` are already plain supabase-js |
| Realtime | supabase-js `postgres_changes` (same as web) | Port the chat reconnect logic as-is |
| Push | Expo push tokens via `expo-notifications`; edge function gains an Expo path | One API for APNs + FCM; web push path stays for PWA users |
| Charts | `victory-native` (Skia) or `react-native-gifted-charts` | recharts is DOM-only. Pick one in Phase 2, prefer victory-native |
| Styling | `StyleSheet` + tokens in `src/constants/theme.ts` | Keep it boring. NativeWind is acceptable if the porting agent prefers Tailwind-shaped code, but decide once |
| Screen Time (iOS) | `react-native-device-activity` (Kingstinct) | Expo config plugin, wraps FamilyControls + ManagedSettings + DeviceActivity |
| App blocking (Android) | `expo-app-blocker` or a small custom module | UsageStatsManager + overlay; sideloaded so no Play policy review |

## Repo layout

```
src/app/            Expo Router routes (screens). Only screens live here.
src/components/     UI components (empty - build the kit in Phase 0)
src/constants/      theme.ts = Paper & Pine tokens, ported from globals.css
src/hooks/          useTheme, useColorScheme
src/lib/            SHARED PURE LOGIC copied verbatim from the web app.
                    DOM-free. Do not add react/react-native imports.
supabase/           Owned here now. migrations/, functions/send-push, admin_examples.sql
reference/web-pwa/  The web UI, read-only, for 1:1 porting. Excluded from tsconfig.
docs/               This file, DECISIONS.md, SCREEN-TIME.md, PUSH.md, legacy/
assets/brand/       The PWA's icons (placeholder open-book mark). Replace for the store.
scripts/gen-icons.mjs  Regenerates those icons from inline SVG (needs sharp)
```

Path alias `@/*` -> `src/*`, same as the web app, so `src/lib` imports work
unchanged.

## What is already done (Phase 0 code complete; dev build pending owner)

- [x] Expo project scaffolded (default template, trimmed). `npx tsc --noEmit` passes.
- [x] `src/lib/` copied: dates, entries, feedGroups, format, khatmah, mushaf,
      nudges, position, progress, reminders, types, insights (2,626 lines).
- [x] `supabase/` moved here (24 migrations, send-push edge function, admin SQL).
- [x] Design tokens ported to `src/constants/theme.ts` (colors light/dark, type
      ramp, radii, spacing, elevation).
- [x] `app.json`: name Iqra, slug iqra, scheme `iqra`, splash colors, bundle
      id placeholders `com.qadamtechnologies.iqra` (see Owner tasks).
- [x] `.env.example` with the public Supabase URL and publishable key.
- [x] `docs/DECISIONS.md` carries every owner decision from the web build.
- [x] `src/supabase/client.ts` + `secureStorage.ts`: one client, chunked
      expo-secure-store session adapter, AppState auto-refresh toggle.
- [x] `src/lib/auth.ts` (Profile type, `isOnboarded`), `src/lib/data.ts`
      (every web query, takes the client as first arg), `src/lib/deepLinks.ts`.
- [x] `src/providers/SessionProvider.tsx` and `ThemeProvider.tsx` (system /
      light / dark override persisted in AsyncStorage, key `iqra:theme`).
- [x] Route tree with the Stack.Protected auth gate, NativeTabs, Settings
      as a stack screen, typed routes generated.
- [x] UI kit: Button, Card, Field (FieldLabel, Input, Textarea, TimeInput),
      Badge, Avatar, SegmentedControl, Sheet; plus AppMark and Placeholder.
- [x] Login screen ported (Phase 1 item, pulled forward so the dev build can
      be exercised end to end). Onboarding is a stub with Sign out.
- [x] `eas.json` profiles; `expo-dev-client` installed; `npx expo-doctor` clean.

Not done from Phase 0: the first EAS dev build (needs owner tasks 2 and 4).

## Owner tasks (cannot be done by an agent)

Do these early; several are long poles.

1. ~~Pick the bundle id~~ Done: `com.qadamtechnologies.iqra` (Qadam Technologies
   Inc., the org on the Apple account). Already set in `app.json`.
   If Apple reports it as taken when creating the App ID, fall back to
   `com.qadamtech.iqra`: find-and-replace in `app.json`, this file, and
   `docs/SCREEN-TIME.md`, then commit.
2. **Create the App ID + app record** in App Store Connect under the org.
3. **File the Family Controls (Distribution) requests on day one.** Four of
   them: the app bundle id plus `.DeviceActivityMonitor`,
   `.ShieldConfiguration`, `.ShieldAction`. Must be submitted by the org's
   **Account Holder**, not an Admin. Form and wording in `docs/SCREEN-TIME.md`.
   Expect days to weeks; open a DTS ticket after two silent weeks.
4. **EAS account**: the Expo account is the personal `danyal0726` login
   (Expo project `@danyal0726/iqra`, created 2026-10-16). The Apple ID is a
   different thing: when `eas build` asks for Apple credentials, sign in as
   `danyal@theqadamapp.com` and pick the Qadam Technologies Inc. team. If
   this machine is logged out of EAS, run `npx eas-cli@latest login`
   (danyal0726), then `npx eas-cli@latest init` to relink (drop any
   `extra.router.asyncRoutes` it adds to app.json, commit). Then
   `npx eas-cli@latest build --profile development --platform ios`: say yes
   to letting EAS manage credentials and let it create the distribution
   certificate, the ad-hoc provisioning profile (register your iPhone's UDID
   when prompted via the link it prints) and the push key.
5. **APNs key** (.p8): EAS creates it under the org account when prompted.
6. **Supabase**: generate an Expo access token (expo.dev -> Access tokens)
   and set it as the `EXPO_ACCESS_TOKEN` secret on the edge function when
   Phase 3 lands. Paste the push migration from Phase 3 into the SQL editor.
7. **Android keystore**: let EAS generate and hold it.
8. **Test devices**: your iPhone for Screen Time (simulator cannot run it).

## Phase plan

Each phase ends with `npx tsc --noEmit`, `npx expo lint`, a commit, and an
update to the Status section at the bottom of this file.

### Phase 0 - Foundation (single-threaded, one agent)

- [x] `src/supabase/client.ts` (NOT `src/lib/`: it imports react-native's
      AppState and the lib must stay RN-free): one shared client, chunked
      `expo-secure-store` session adapter (`secureStorage.ts`; sessions can
      exceed the old 2 KB keychain item limit), `AppState` listener to
      start/stop auto refresh. Realtime `setAuth` is already done inside
      supabase-js on every auth event, so no extra listener; the web
      `heartbeatCallback` reconnect is ported, `worker: true` dropped.
- [x] `src/providers/SessionProvider.tsx`: session, user, profile,
      `isOnboarded`, `loading`, `refreshProfile()`, `signOut()` (local
      scope). `Profile` + `isOnboarded` live in `src/lib/auth.ts` (pure).
- [x] Route structure (as below, plus `src/app/index.tsx` redirecting to
      `/today` and `src/app/(auth)/_layout.tsx`):
  ```
  src/app/_layout.tsx          providers, auth gate (redirect to login / onboarding)
  src/app/(auth)/login.tsx
  src/app/onboarding.tsx
  src/app/(tabs)/_layout.tsx   NativeTabs: Today, Feed, Chat, Insights, Journal
  src/app/(tabs)/today.tsx | feed.tsx | chat.tsx | stats.tsx | journal.tsx
  src/app/settings.tsx         stack screen over tabs
  ```
- [x] UI kit in `src/components/ui/` (barrel `index.ts`): Button, Card,
      Field (FieldLabel, Input, Textarea, TimeInput via
      `@react-native-community/datetimepicker`), Badge, Avatar (expo-image),
      SegmentedControl, Sheet (Modal + Reanimated + gesture-handler v3 hook
      API; `dragAnywhere={false}` when the content is a ScrollView). Tab bar
      is NativeTabs. Lucide via `lucide-react-native` for in-screen icons;
      tab icons are SF Symbols / Material Symbols.
- [x] `src/lib/data.ts`: every query ported; each takes `supabase` as its
      first argument so the file stays RN-free. `fetchAll` and the
      newest-first comments kept verbatim.
- [x] Deep links: scheme `iqra://` (app.json). Expo Router resolves
      `/today`, `/chat`, `/stats` into `(tabs)` directly. Today validates
      `log` against `TYPES_BY_MODE` and `r` as a UUID; Stats reads
      `section`. `src/lib/deepLinks.ts#toNativeHref` turns a push `url`
      (`/stats#recap`) into `/stats?section=recap` for the Phase 3
      notification-response handler. Known gap: a cold-start deep link while
      signed out is dropped by the gate (login first, then land on Today).
- [x] `eas.json` profiles: development (dev client, internal), preview
      (internal, Android apk), production (autoIncrement).
- [ ] First dev build on a real iPhone: `eas build --profile development --platform ios`.
      Blocked on owner tasks 2 (App ID) and 4 (`eas init`); see Status.

### Phase 1 - Core screens (parallelizable after Phase 0; ultracode OK)

Port each from `reference/web-pwa/`. Keep behavior identical; the web
components have comments explaining every non-obvious rule.

- [x] Login (`app/login/LoginForm.tsx`): ported in Phase 0 as
      `src/app/(auth)/login.tsx`. The gate navigates; the screen never does.
- [ ] Onboarding (`app/onboarding/OnboardingFlow.tsx`): name, mode, timezone
      (from device), mushaf. Stub exists at `src/app/onboarding.tsx`; call
      `refreshProfile()` from `useSession()` after the upsert so the gate
      flips to the tabs. Drop the web's step 3 (Add to Home Screen).
- [ ] Today (`app/(app)/today/TodayClient.tsx` + `components/LogSheet.tsx` +
      `SpeedDial.tsx` + `WheelPicker.tsx` + `DayReminders.tsx` +
      `Celebration.tsx` + `EntryRow.tsx`). This is the heart of the app:
      hifz fan-out vs reading FAB, 3 AM backdating window, "Remind me" pill,
      day-reminder presets, confetti. Haptics on save.
- [ ] Journal (`JournalClient.tsx`, `entryWrites.ts`): all-time entries,
      edit/delete sheets shared with Today.
- [ ] Settings (`app/(app)/settings/page.tsx` + ProfileSection,
      frame + ThemeToggle (SegmentedControl on `useThemeContext`) + SignOut
      already in `src/app/settings.tsx`; add the rest:
      RemindersManager, NotificationsToggle, CelebrateToggle, ThemeToggle,
      MushafSelect, SignOutButton, DeleteAccount). NotificationsToggle
      becomes the Expo push permission flow (Phase 3). DeleteAccount calls
      a new edge function (Phase 3) instead of the Next API route.

### Phase 2 - Social and stats (parallelizable; ultracode OK)

- [ ] Feed (`FeedClient.tsx`, `lib/feedGroups.ts`, `lib/nudges.ts`):
      grouped activity, nudge button with 15 s re-nudge cooldown, realtime.
- [ ] Chat (`ChatClient.tsx`, 1,722 lines, the hardest port). Port, do not
      redesign: realtime join/rejoin with fresh topic per join, REST resync
      on every (re)join, UTC parsing of offset-less timestamps, read
      frontier, reactions, replies, swipe-to-reply, long-press menu,
      @mention autocomplete and `@all`, search, mute. Use `FlashList` or
      inverted `FlatList`; keyboard handling via
      `react-native-keyboard-controller`.
- [ ] Stats (`StatsClient.tsx`, ProgressCard, KhatmahCard,
      HifzBreakdownCard, chartKit): pick the chart lib, port the four cards,
      recap section reachable by deep link.

### Phase 3 - Push, deep links, first TestFlight (single-threaded)

Design is in `docs/PUSH.md`. Summary:

- [ ] `expo-notifications`: request permission from Settings toggle, get the
      Expo push token, upsert into `push_subscriptions` with a native shape.
- [ ] Migration: `push_subscriptions.kind` ('web' | 'expo') or store the
      Expo token in the existing `subscription` jsonb as
      `{"expo": "ExponentPushToken[...]"}` so no schema change is needed.
      Prefer the jsonb approach (no migration to paste). Decide, document.
- [ ] Edge function `send-push`: branch per row. Web rows -> web-push as
      today. Expo rows -> batch POST to `https://exp.host/--/api/v2/push/send`
      with `EXPO_ACCESS_TOKEN`; prune on `DeviceNotRegistered`. Keep the
      `url` payload key; map it to `data.url` for Expo and handle it in the
      notification-response listener to navigate.
- [ ] Edge function `delete-account` (service role) replacing
      `reference/web-pwa/app/api/account/route.ts`.
- [ ] Foreground notification behavior: show banner for chat only when not
      on the chat screen.
- [ ] `eas build --profile production --platform ios` -> `eas submit` ->
      TestFlight external group with a public link. First build needs Beta
      App Review (one to two days).
- [ ] `eas build --profile preview --platform android` -> APK -> send the
      EAS internal-distribution link to the Android member.
- [ ] `eas update` configured (channel per profile) so JS fixes ship OTA.

### Phase 4 - Screen Time (single-threaded, needs a real iPhone)

Design is in `docs/SCREEN-TIME.md`. Ship this in a later TestFlight build
once Apple approves the entitlement; do not block Phase 3 on it.

### Phase 5 - Retire the PWA

- [ ] Every member installed from TestFlight / APK and push works for them.
- [ ] Remove the web-push branch from `send-push`, drop web rows.
- [ ] `fly scale count 0` on the web app; leave the repo as an archive.

## Working notes for the next agent

- The Expo template pinned `expo-router@~58.0.22`, which was not on npm on
  2026-10-16; it is pinned to `~58.0.21`. Run `npx expo install --fix`
  when 58.0.22 lands.
- `web.output` in app.json is `static` and there are no `.web.tsx` files;
  web is not a target. Do not spend time on it.
- `reactCompiler` and `typedRoutes` experiments are on from the template.
  Keep them unless they fight you.
- Shared lib note: `src/lib/format.ts` and friends format with
  `toLocaleTimeString("en-US", ...)`. Hermes supports Intl, fine.
- `src/lib/insights.ts` returns markdown-ish `**bold**` spans in copy; the
  web rendered them with a tiny parser. Port that parser into a `RichText`
  component rather than changing the lib.
- Timezone: web took it from the profile, set at onboarding from the
  browser. Native: `Intl.DateTimeFormat().resolvedOptions().timeZone` works
  on Hermes; also offer the picker because members travel.
- Screens get data by calling `src/lib/data.ts` with the shared client:
  `getMyMembership(supabase)`, `getMyRecentEntries(supabase, groupId, userId)`.
  `useSession()` gives `user`, `profile`, `refreshProfile`, `signOut`.
- The session is stored under `iqra-auth` (explicit `storageKey`) so
  SessionProvider can hard-clear it if `signOut()` returns an error.
- Auth gate: while `loading` every Stack.Protected guard is false; Expo
  Router logs a dev-only "All routes in this navigator are protected"
  warning under the splash. Harmless and expected; do not "fix" it by
  mounting login early (its autoFocus would pop the keyboard).
- Gesture handler is v3 (hook API: `usePanGesture`, `GestureDetector`).
  Callbacks need the `"worklet"` directive to run on the UI thread; hop back
  with `scheduleOnRN` from `react-native-worklets`. A Modal needs its own
  `GestureHandlerRootView` (see Sheet).
- React 19: `ref` is a prop; the kit's Input/Textarea take `ref` directly
  (no forwardRef). The lint rule `react-hooks/set-state-in-effect` is on;
  adjust state during render (Sheet) or in callbacks instead.
- Typed routes live in `.expo/types/router.d.ts` (gitignored). They are
  regenerated by `npx expo start`; run it once after adding a route or
  `tsc` will not know the new href.
- Ultracode: good for Phase 1 and 2 (independent screens). Not for Phase 0,
  3, or 4, which need one consistent thread of decisions.
- Model guidance from the owner: run Fable 5.1 by default, high or xhigh
  effort for chat, push, and native work. Use Xcode 26's Claude Agent only
  for the Swift extension targets and signing issues, never for RN code.

## Status

| Phase | State | Notes |
|---|---|---|
| 0 Foundation | code complete, build pending | Everything in the Phase 0 list is built, typechecked and linted (2026-10-16). Only the first EAS dev build remains, blocked on owner tasks 2 (App ID in App Store Connect) and 4 (`eas init`). Login was ported early; onboarding is a stub. |
| 1 Core screens | not started | |
| 2 Social + stats | not started | |
| 3 Push + TestFlight | not started | |
| 4 Screen Time | not started | Entitlement requests: NOT YET FILED (owner task 3) |
| 5 Retire PWA | not started | |
