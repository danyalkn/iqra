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
| Charts | `victory-native` 42 on `@shopify/react-native-skia` 2.14 (decided 2026-10-16) | recharts is DOM-only. Skia canvas with a real numeric time axis (tickValues + formatXLabel), per-axis tick values for the Juz Y scale, Reanimated press tooltips that work on the New Architecture, colours as plain props for live theme flips. gifted-charts is index-spaced with equal Y sections only and its pointer tooltip is broken on iOS New Arch (issue #1219) |
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

## What is already done (Phase 0 complete)

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

- [x] First EAS development build installed on the owner's iPhone 16 Pro
      (2026-10-16): login, gate, native tabs, Settings and dark mode verified
      on device. Credentials (distribution cert, ad-hoc profile, push key)
      are held by EAS under the Qadam Technologies team.

## Owner tasks (cannot be done by an agent)

Do these early; several are long poles.

1. ~~Pick the bundle id~~ Done: `com.qadamtechnologies.iqra` (Qadam Technologies
   Inc., the org on the Apple account). Already set in `app.json`.
   If Apple reports it as taken when creating the App ID, fall back to
   `com.qadamtech.iqra`: find-and-replace in `app.json`, this file, and
   `docs/SCREEN-TIME.md`, then commit.
2. **Create the App ID + app record** in App Store Connect under the org.
3. **File the Family Controls (Distribution) requests on day one.** Four of
   them: the app bundle id plus `.ActivityMonitorExtension`,
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
  src/app/(tabs)/_layout.tsx   NativeTabs: Today, Feed, Chat, Insights, Profile
  src/app/(tabs)/today.tsx | feed.tsx | chat.tsx | stats.tsx | profile.tsx
  src/app/settings.tsx         stack screen over tabs
  src/app/journal.tsx          stack screen over tabs, opened from Today
  (Owner decision 2026-10-16: Profile replaced Journal as the fifth tab;
  the system tab bar is not to be restyled.)
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
- [x] First dev build on a real iPhone: `eas build --profile development --platform ios`.
      Done 2026-10-16. For later dev builds just rerun the command; Metro
      runs on `npx expo start --port 8082` (8081 is taken by another project
      on the owner's Mac).

### Phase 1 - Core screens (parallelizable after Phase 0; ultracode OK)

Port each from `reference/web-pwa/`. Keep behavior identical; the web
components have comments explaining every non-obvious rule.

- [x] Login (`app/login/LoginForm.tsx`): ported in Phase 0 as
      `src/app/(auth)/login.tsx`. The gate navigates; the screen never does.
- [x] Onboarding (`app/onboarding/OnboardingFlow.tsx`): two steps (mode;
      name + timezone picker + mushaf + first daily reminder), web step 3
      dropped. `src/app/onboarding.tsx`, `src/components/onboarding/`,
      `src/components/TimezonePicker.tsx` (searchable IANA sheet, device zone
      pinned, `Intl.supportedValuesOf` with a static fallback). Awaits
      `refreshProfile()`; the gate flips.
- [x] Today (`src/app/(tabs)/today.tsx` + `src/components/LogSheet.tsx`,
      `SpeedDial.tsx`, `WheelPicker.tsx`, `DayReminders.tsx`,
      `Celebration.tsx`, `EntryRow.tsx`, `EmptyState.tsx`, `entryIcons.ts`;
      edit/delete writes in `src/data/entryWrites.ts`). Hifz fan-out vs
      reading FAB, 3 AM window with an AppState recheck, Remind me pill,
      presets, confetti (reduce-motion aware), haptics on save and on failed
      writes. Push state is a Phase 3 stub ("off").
- [x] Journal (`src/app/journal.tsx`): all-time entries, by day / by juz,
      filters, Show more, edit/delete via the shared LogSheet. The web's
      sessionStorage "entries changed" flag is an in-memory flag in
      `entryWrites.ts` that Today consumes on focus.
- [x] Profile tab (`src/app/(tabs)/profile.tsx` + `src/components/profile/`):
      avatar, name, mode and mushaf pills, Streak / This month tiles, "Where
      you are" (bookmark or sabak total), rows into Journal and Settings.
      Personal only (DECISIONS "no showing off"). Pull to refresh.
- [x] Settings (`src/app/settings.tsx` + `src/components/settings/`):
      ProfileSection (edit sheet with the timezone picker), MushafSelect,
      Appearance, NotificationsToggle (disabled Phase 3 stub), CelebrateToggle
      (`PREF_KEYS.celebrate`), RemindersManager, Sign out, DeleteAccount
      (`src/data/account.ts` invokes the `delete-account` edge function that
      Phase 3 deploys; until then it reports "not available in this build").
- [x] Chart library decided: victory-native on Skia (see Stack and the
      working note). Installed; Stats itself is Phase 2.
- [ ] Device verification of all of the above on the owner's iPhone after a
      dev-client rebuild (expo-haptics and Skia are native modules). Checklist
      in the working notes below.

### Phase 2 - Social and stats (parallelizable; ultracode OK)

Ported 2026-10-16 with one workflow of five agents (Feed, Chat list,
Chat composer, Stats charts, Stats screen) against pinned contracts,
then an adversarial review workflow (three lenses, three skeptics per
finding, one fixer per unit). Native modules added: `@shopify/flash-list`,
`react-native-keyboard-controller`, `expo-clipboard`; `KeyboardProvider`
is mounted in the root layout. The dev client must be rebuilt before the
Chat tab can load.

- [x] Feed (`src/app/(tabs)/feed.tsx` + `src/components/feed/`): grouped
      activity (one card per person per day), logged-today strip, nudge
      pills with the 15 s cooldown seeded from `getMyRecentNudges`, two-tap
      delete of your own entries, realtime INSERT on `log_entries`, refetch
      on focus and foreground return, error state with retry.
- [x] Chat (`src/app/(tabs)/chat.tsx` + `src/components/chat/`): the web
      reconnect logic ported line for line in `useChatSync.ts` (fresh
      topic per join, REST resync on every (re)join, backoff, `ensureLive`
      on foreground return, 20 s safety poll while visible, expired-token
      and anon-downgrade retries), read frontier, reactions, replies,
      swipe-to-reply and swipe-left-to-reveal-times (gesture-handler v3),
      long-press overlay (react, reply, copy), @mention typeahead and
      `@all`, members sheet with the mute toggle and the owner-only add
      member search, FlashList 2 (non-inverted, renders from the bottom)
      inside keyboard-controller's `KeyboardAvoidingView`.
- [x] Stats / Insights (`src/app/(tabs)/stats.tsx` + `src/components/stats/`):
      chartKit as `useChartColors` + `useChartFont` (Skia `matchFont`) +
      `ChartTooltip` + `useChartPress`, a shared `PagesBarChart`, the three
      cards (ProgressCard, KhatmahCard, HifzBreakdownCard as three small
      multiples), recap card reachable by `?section=recap` (scrolls once,
      then clears the param), stat tiles, month browser, leaderboard,
      insights with a `RichText` parser for the engine's `**bold**` spans,
      heatmap, coverage sheet, Journal link. Personal scope only outside
      the leaderboard.
- [ ] Device verification on the owner's iPhone after the dev-client
      rebuild (checklist in the Phase 2 working notes below).

### Phase 3 - Push, deep links, first TestFlight (single-threaded)

**The full plan is `docs/PHASE3.md`** (written 2026-10-16 from a check of
the code, the migrations and the SDK 58 / EAS docs; it corrects
`docs/PUSH.md` where the two differ and ends with the kickoff brief to
paste into the next session). Summary:

- [ ] `expo-notifications` + config plugin, dev-client rebuild, `src/push/`
      (register / unregister / state, chat visibility), the Settings toggle
      and `DayReminders` off their stubs, sign-out deletes the device row.
- [ ] `PushController` in the root layout: foreground handler (suppress
      `chat-*` while the chat is on screen), tap routing through the auth
      gate via `toNativeHref`, cold-start and signed-out cases.
- [ ] Interactive notifications (owner request): `log-reading` /
      `log-hifz` categories with action buttons and a text input so a
      reminder can log an entry without opening the app where the platform
      allows it; otherwise it opens straight into a prefilled log sheet.
- [ ] `send-push`: Expo branch (exp.host batch, `DeviceNotRegistered`
      pruning, `categoryId`), pinned imports. One migration: revoke public
      execute on `send_push`, reminder jobs add `category`.
- [ ] Edge function `delete-account` (service role, verify the JWT).
- [ ] Version bump, production build, `eas submit`, TestFlight external
      group with a public link, Android APK via `preview`, `eas update`
      smoke test.

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
- Auth gate: `src/app/index.tsx` is the unguarded anchor. It renders null
  while the session loads (splash covers it) and then redirects to login,
  onboarding or /today. Every other route sits behind a Stack.Protected
  guard. Do not guard `index`: on the first device build a cold start at
  `/` resolved while every guard was false and stuck on "Unmatched Route".
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
- Charts (decided 2026-10-16, Phase 1): `victory-native` 42.0.1 on
  `@shopify/react-native-skia` 2.14.0, the SDK 58 bundled version, no config
  plugin; installed, needs the dev-client rebuild that expo-haptics already
  forced. Port `chartKit` as a native `useChartColors` reading theme tokens
  plus a `useChartFont` built on Skia's `matchFont` (system font, no .ttf to
  bundle): labels render only when a font is passed. Two corrections to the
  web-era assumptions: HifzBreakdownCard is three small-multiple bar charts,
  not a stacked bar, and no chart shows two Y axes at once (ReadingView swaps
  between a Juz-tick axis and a 0-auto axis). Categorical axes use the index
  as `xKey` with `formatXLabel` returning "" to skip labels. Watch open
  issue #630 (memory leak with animated charts): keep animation off as the
  web does and check memory after a few Stats visits in the dev client.
- Phase 1 notes (2026-10-16):
  - `Sheet` owns keyboard avoidance (a root KeyboardAvoidingView in the
    Modal; a nested one inside the bottom-anchored panel cannot measure the
    overlap). Sheet content must not add its own. `panel` and `panelInner`
    flexShrink so a ScrollView child shrinks and scrolls. `CLOSE_MS` is
    exported; Today waits for it before the celebration.
  - `SessionProvider` publishes session and profile together on auth events
    (profile loads first), so the gate never flashes onboarding at a member
    who is already onboarded.
  - Shared lib fix to mirror to the web repo: `fetchAll` in `src/lib/data.ts`
    now throws on a page error instead of returning the rows so far. Before,
    a failed load read as an empty history ("Nothing logged yet").
  - Web bug to mirror: web `ProfileSection` saves any typed string into
    `profiles.timezone`; a bad zone aborts the shared reminder cron for
    everyone (`now() at time zone p.timezone`). Native validates with
    `isValidTimezone` from `TimezonePicker.tsx` before saving.
  - Today's "longest" streak is bounded by the 120-day
    `getMyRecentEntries` window on both apps; Profile's "best ever" is
    all-time, so the two can differ for long streaks.
  - Today derives "today", the date label and the Hijri line from a
    minute-aligned `useNow()` so the React Compiler does not freeze them.
  - Insets inside NativeTabs (corrected 2026-10-16 after the iOS 26.5
    simulator check): react-native-screens does NOT add a top content inset
    to the tab screens, so every tab pads `insets.top` itself (Today's shape:
    a root View with `paddingTop: insets.top` and the ScrollView inside it,
    which also keeps the pull-to-refresh spinner visible). At the bottom the
    liquid-glass bar is translucent and minimises, so iOS adds
    `insets.bottom` to the fixed clearance (112 on Today under the FAB, 40
    elsewhere); Android keeps the fixed value because expo-router wraps the
    screen in a bottom SafeAreaView. The earlier assumption ("pad 0 at the
    top on iOS") put Feed, Profile and Insights under the Dynamic Island.
  - Device checklist for the Phase 1 build: (1) log a reading: keyboard rises
    with Pages focused, Save stays visible, confetti after the sheet closes,
    success haptic; (2) hifz: + fans out with the Remind me pill, three
    wheels snap with a tick per row, Starts at / Portion columns swap;
    (3) before 3 AM the Today / Yesterday control appears and "Saved to
    yesterday." shows; (4) Remind me sheet: presets, compact time picker,
    the "not set up yet" note links to Settings; (5) Journal: back pops,
    filters bleed to the edges, edit and delete round-trip to Today;
    (6) Settings: Edit profile and Delete account sheets lift above the
    keyboard, mushaf change restamps the next entry, Delete shows the
    "not available in this build yet" line; (7) Profile: numbers update after
    logging on Today; (8) new account: onboarding two steps, timezone picker,
    lands on Today with no flash; (9) FAB and last rows clear the liquid-glass
    tab bar in both its full and minimized states; (10) dark mode on every
    screen.
- Phase 2 notes (2026-10-16):
  - `useNow()` moved to `src/hooks/use-now.ts` (optional tick interval);
    Feed ticks once a second while a nudge cooldown runs. Every screen
    derives `today` from it, never from a bare `Date.now()` in render.
  - Feed, Chat and Stats refetch on every tab focus instead of consuming
    the `entryWrites` "entries changed" flag: Today consumes that flag on
    its own focus, so a second consumer would race it. Five members make
    the extra queries negligible.
  - Several `src/lib/data.ts` helpers swallow errors (`getGroupMembers`,
    `getGroupEntries`, `getGroupMessages`, `getGroupReactions`,
    `getGroupChatReads`, `getMyRecentNudges` return `[]`). Feed and Chat
    run those selects natively (same query) so a dead network is an error
    state with retry, not an empty circle. Candidate lib fix to mirror to
    the web: return or throw the error as `fetchAll` now does.
  - Web bug to mirror: the web `FeedClient` realtime handler files
    `payload.new` by `logged_at` without the bare-timestamp-is-UTC guard
    the chat has (`parseTs`); a live insert can land on the wrong local
    day until reload. Native normalises it (`utcIso` in `feed.tsx`).
  - Chat keyboard geometry (iOS): the screen root reaches the window
    bottom under the translucent tab bar, so the composer pads
    `insets.bottom` itself and keyboard-controller's `KeyboardAvoidingView`
    runs with `keyboardVerticalOffset = -insets.bottom` and
    `automaticOffset` so the field ends exactly on the keyboard. Android:
    composer pads 8, offset 0. If the field sits too high or low on
    device, adjust `KEYBOARD_GAP` / the offset in `chat.tsx`.
  - Chat list: FlashList 2 non-inverted with
    `maintainVisibleContentPosition { startRenderingFromBottom,
    autoscrollToBottomThreshold: 120 }`, no pull-to-refresh (a bottom
    anchored chat reads pull-down as "load older", which the 100-message
    window never offered). Own sends always scroll to the end; others'
    only when within 120 of the bottom. Double tap, long press and the
    per-row pan are keyed by message id so recycled cells cannot inherit
    a gesture. Reaction chips drop the web's pop animation for the same
    reason.
  - Chat composer: return inserts a newline and only the Send button
    sends (phones have no Shift+Enter). Typeahead has no arrow-key
    navigation; the first row is active and any row picks on press-in.
    Search and add-member failures show an error line (the web ignored
    both).
  - Chat first load runs on the tab's first focus (the web's window
    focus handler), not in a mount effect: `react-hooks/set-state-in-effect`
    sees through the sync helpers. `visible` = focused AND AppState
    active; `markRead` and the 20 s poll both gate on it because
    NativeTabs keeps every tab mounted.
  - Charts: victory-native hard-codes d3 `nice()` on the y scale, so the
    Juz axis of the reading bookmark chart runs 0..650 for the 604-page
    mushaf instead of 1..604 (ticks and line land in the same places).
    The "1 khatmah" reference line now shows from 60% of a khatmah onward
    (recharts' default `ifOverflow="discard"` hid it on the web until the
    auto domain passed 604, which made the threshold a no-op); to mirror
    the web's actual behaviour delete the `showKhatmahLine ? total : 0`
    term in `ReadingView`'s `cumTicks` memo. Press tooltips show while a
    finger is held (victory's press activates after a 100 ms long press
    so quick swipes still scroll). `useChartFont` caches one Skia
    typeface per size (iOS "Helvetica", Android "sans-serif"); a throw
    yields `null` and labels are skipped rather than crashing.
  - `SegmentedControl` renders subhead text at both sizes; the
    Memorizing / Reading toggle in ProgressCard and the four-way hifz
    filter are therefore a little taller than the web's caption pills. A
    real `sm` size in the kit would fix both.
  - Review pass (2026-10-16): 38 findings from three lenses (parity,
    platform, data), 28 confirmed by at least two of three skeptics and
    applied. Cross-cutting fixes made in the main session afterwards:
    - Shared lib fix to mirror to the web repo: `getMyMembership` in
      `src/lib/data.ts` now throws on a request error. Before, a dead
      network at launch read as "not in a circle" on every group screen
      (the web redirects to the same placeholder on a failed read).
      `useMembership` no longer caches a failed read: it stays `undefined`
      with a new `failed` flag and retries on foreground return, on mount
      and on `refresh()`. Feed, Chat and Stats keep their own second-opinion
      membership reads as belt and braces (comments say so).
    - Shared lib change to mirror: `currentStreak(loggedDays, tz, now =
      Date.now())` takes the clock as an argument. Under the React Compiler
      a bare call was memoized on the logged days alone, so a resident tab
      kept yesterday's streak past midnight and the 3 AM cutoff. Today,
      Profile and Stats pass `useNow()`; Profile now derives `today` from
      `useNow()` too (it used a bare `todayLocal(tz)`).
    - Stats carries throwing copies of `getGroupMembers` / `getGroupEntries`
      (`getGroupMembersStrict` / `getGroupEntriesStrict` in `stats.tsx`);
      Feed and Chat do the same inline. Fold them back once the shared
      helpers surface their errors.
    - Chat list: FlashList's `autoscrollToBottomThreshold` is a ratio of
      the viewport, not pixels (`useBoundDetection.js`), so it was dropped;
      following the bottom is done only by the screen's own gated
      `scrollToEnd` (own sends always, others' within 120 px).
    - Feed: a refetch merges instead of replacing (deleted ids filtered,
      realtime rows that arrived during the fetch kept), so a focus refetch
      cannot resurrect a deleted entry or drop a live insert.
    - Chat: a send whose id a sync already merged drops the temp row
      (no duplicate FlashList keys); reaction settle steps replace by
      message_id + user_id; the reactors sheet freezes its list while
      sliding out; the long-press overlay waits for the keyboard to hide
      before measuring; bubbles expose react / reply / copy as
      accessibility actions.
    - Stats: recap deep-link scroll subtracts the top inset; the selected
      month resets on every focus (the web remounted); AppState "active"
      reloads the focused tab; the heatmap tooltip renders only once
      measured.
  - Device checklist for the Phase 2 build: (1) Feed: logged-today strip
    ticks match Today, nudge pill counts down 15 s and re-enables, a
    second device's log appears live, two-tap delete round-trips to Today;
    (2) Chat: field sits exactly on the keyboard with the tab bar hidden,
    swipe down on the composer dismisses it, list stays pinned when the
    keyboard opens, swipe right on a message replies (haptic), swipe left
    reveals times for every row, long press shows the emoji pill and the
    Reply / Copy menu placed above or below as room allows, double tap
    hearts, read-receipt avatars sit under the right message, a message
    sent from another device arrives, background the app for >15 s and
    return (messages sent meanwhile appear), @ typeahead inserts the name
    with the caret after it, members sheet mute toggle persists, owner
    sees Add member; (3) Insights: axis labels render on both platforms
    (if a chart has no labels `matchFont` threw), press-and-hold shows
    the tooltip and a quick swipe still scrolls, the trailing dot on the
    line charts is a full circle, the tallest-week label in Sabak / Sabak
    Para / Dhor is not clipped, the Sunday recap push scrolls to "Your
    week" once (also when the tab was left on Group), heatmap tooltip
    placement on the edge columns, memory after several visits (six Skia
    canvases live on the tab, issue #630); (4) dark mode on all three.
- Simulator walkthrough (2026-10-16, iPhone 16 Pro / iOS 26.5, owner's
  account, driven with idb; see the memory note on simulator testing):
  Login, Today (log, hifz wheels, Remind me), Journal (edit / delete
  round-trip), Profile, Settings, Feed (strip, cards, two-tap delete), Chat
  (members sheet, mute, grouping, receipts, keyboard, swipes, long-press
  menu, reactions, copy, typeahead, reconnect after background) and Insights
  (every card, tooltips, scopes, month browser, leaderboard, recap deep link,
  heatmap) all passed; memory flat over repeated Insights visits; Metro
  logged no errors. Ten defects were found and fixed the same day (chart
  swipes not scrolling, chat opening short of the bottom, top insets,
  bottom clearance, typeahead over the composer, tall sheet under the
  status bar, clipped "Where you are" switch, dark theme not reaching the
  keyboard, dark segmented-control contrast, tooltip over the press dot,
  heatmap tooltip surviving a tab switch, confetti before the keyboard is
  gone, missing field labels, DateTimePicker deprecation, shadow advisories),
  then re-verified on the simulator: all ten gone, no regressions. One
  more fix from that pass: Today re-reads the list after a failed delete
  instead of restoring a tap-time snapshot (a request that fails after the
  server committed used to resurrect the row). The Journal still restores
  the row on error; it is a stack screen that reloads on open, so it was
  left as is. The simulator cannot judge haptics, and `idb ui text` drops
  "." and shifted characters, so type credentials one character at a time.
  Still owner-only on the phone: haptics and the wheel tick, the Today /
  Yesterday control before 3 AM, live messages and entries from a second
  device, the nudge countdown (a nudge pushes a real member), onboarding
  with a new account, Delete account's "not available" line, the trailing
  line-chart dot.
- Dev builds on the phone (2026-10-16): EAS uses its remote version
  counter (`appVersionSource: remote` in eas.json), so a `buildNumber` in
  app.json is ignored. The development profile now has `autoIncrement`, so
  each dev build shows a distinct "(n)" in the dev launcher and installs
  over the previous one. Builds 0e480b25 and ff2ff734 (both "0.1.0 (1)")
  required deleting the Phase 0 app first; a "native module X not found"
  red box after a rebuild means the old binary is still installed, never
  that the bundle is wrong. A Metro left running across `npx expo install`
  serves a stale module graph (red box "requireOptionalNativeModule of
  null"): restart it with `--clear`.
- Phase 3 notes (2026-10-16): push code lives in `src/push/` (imports
  react-native, so never in `src/lib`). The notification handler and the
  category registration run at module scope of `PushController.tsx`; the
  Android background task is defined in `src/push/task.ts` and imported
  first from the custom `index.js` entry. Shared lib addition to mirror to
  the web repo: `src/lib/entryDefaults.ts` (fresh-entry defaults and row
  constructors extracted from LogSheet; pure). Today accepts
  `/today?log=<type>&amount=<n>` to prefill the pages. Everything else is in
  `docs/PHASE3.md` "Progress and decisions made while building".
- Revision plan (2026-10-17): `src/lib/revisionPlan.ts` is a native-only
  shared-lib addition (pure; the web has no revision plan, nothing to
  mirror); it feeds Today's "Revise today" card and the local 20:00 nudges
  in `src/push/revisionNudge.ts`.
- Ultracode: good for Phase 1 and 2 (independent screens). Not for Phase 0,
  3, or 4, which need one consistent thread of decisions.
- Model guidance from the owner (revised 2026-10-16): the main session runs
  Fable 5.1 and only orchestrates, pins contracts, reads agent reports,
  does cross-cutting fixes, verifies and commits. Subagents and workflow
  agents run on Sonnet by default and Opus for the harder units (Chat
  realtime, charts, final review); never Haiku. High or xhigh effort for
  chat, push, and native work. Use Xcode 26's Claude Agent only for the
  Swift extension targets and signing issues, never for RN code.

## Status

| Phase | State | Notes |
|---|---|---|
| 0 Foundation | done | Built, typechecked, linted and verified on the owner's iPhone via an EAS dev build (2026-10-16). Login was ported early; onboarding is a stub. App Store Connect app record still needed before Phase 3 `eas submit`. |
| 1 Core screens | code complete | All five screens, the shared log kit and the chart decision landed 2026-10-16 (typecheck, lint, expo-doctor clean; adversarial review pass applied). Needs a dev-client rebuild (expo-haptics, Skia) and the device checklist in the working notes. Stubs by design: NotificationsToggle and DeleteAccount wait for Phase 3. |
| 2 Social + stats | code complete, simulator-verified | Feed, Chat and Insights ported 2026-10-16 (typecheck, lint clean; adversarial review applied; iOS 26.5 simulator walkthrough passed after eleven device fixes). EAS dev build with the new native modules is built (2026-10-16); owner phone check still open for haptics, the 3 AM window and live multi-device traffic. |
| 3 Push + TestFlight | push verified on device; ship steps open | 2026-10-16: full push stack built and reviewed; migration applied and both edge functions deployed from this machine (CLI linked); test pushes with action buttons verified on the owner's iPhone. Version bumped to 1.0.0. Open: rest of the device checklist, production build, submit, TestFlight group, Android APK, eas update check. **Next session starts from `docs/PHASE4.md`** (also carries the owner request that iOS actions log without opening the app). |
| 4 Screen Time | not started | Plan and sequence in `docs/PHASE4.md` § 3, design in `docs/SCREEN-TIME.md`. Entitlement requests: NOT YET FILED (owner task; the long pole). |
| 5 Retire PWA | not started | Cleanup when App Review no longer needs it: delete the App Review demo circle "Demo Circle" and its three users (`appreview@theqadamapp.com` 325816cb-2bdc-40f8-b1ba-064dc7aea29f, `demo.aisha@example.com` 55fcaf9c-e9c2-44c1-a4fc-71757bd01677, `demo.omar@example.com` dac7e7d6-57bc-42b5-9807-02e1ba5a0327; `user_metadata.cleanup = "phase5"`), deleting the users cascades their rows. Move the privacy policy (`iqra.fly.dev/privacy`, web repo `src/app/privacy/page.tsx`) before `fly scale count 0`, or App Store Connect points at a dead URL. |
