# Next session handoff - offline logging, then Screen Time

Written 2026-10-17 at the end of the session that shipped the first
TestFlight build, for a fresh session and the owner. Read `CLAUDE.md`,
then this file, then `docs/DECISIONS.md` (especially "Logging" and
"Revision plan"), `docs/PHASE3.md` "Progress and decisions made while
building", and `docs/SCREEN-TIME.md`. `docs/PHASE4.md` is the previous
handoff; everything still open from it is repeated here.

Order of work:

1. **Offline logging** (owner request 2026-10-17, the main job). The web
   app could not log without a connection and the owner wants that
   limitation gone in native.
2. Owner checks still open (short, listed below).
3. **Phase 4 Screen Time**, gated on Apple's Family Controls approval.

## State of play (checked 2026-10-17)

- **Shipped.** iOS 1.0.0 (3) is on TestFlight, approved for external
  testing (group "Circle"; the owner enables the public link). App Store
  Connect record "Iqra: Quran Journey", ASC app id 6823874106, team
  69BV989JDV; `eas.json` `submit.production` is filled and an App Store
  Connect API key lives on EAS, so `eas submit` runs non-interactively.
  Android: first APK built (`preview` profile, arm64-v8a only, see the
  eas.json commit for why), link sent to the Android member; no Android
  push until Firebase (owner task below).
- **JS reaches phones by EAS Update only.** The owner's phone now runs the
  TestFlight build, not the dev client, so **Metro on 8082 no longer feeds
  it**. Every JS change ships with BOTH:
  `npx eas-cli@latest update --channel production --environment production --platform ios --message "..." --non-interactive`
  `npx eas-cli@latest update --channel preview --environment preview --platform android --message "..." --non-interactive`
  It lands after the app is closed and reopened twice. A native change
  (new native module, plugin, entitlement) needs a new build AND a version
  bump to 1.1.0, because `runtimeVersion` follows the app version and an
  update built for new native code must never reach the 1.0.0 binary.
- **EAS env**: `EXPO_PUBLIC_SUPABASE_URL` / `_PUBLISHABLE_KEY` exist in the
  development, preview and production environments (they were missing;
  `.env` is gitignored and never uploaded).
- **Done this session** (see `git log` from 65ad20e): iOS reminder buttons
  log headless (PHASE4 option A, verified on the phone once; the
  locked-and-killed case is still unconfirmed), push wrong-account guards,
  16-line Indo-Pak mushaf and pages_equiv converting every mushaf to Uthmani
  pages (migration 20261017120000, applied and recorded), Settings merged
  into Profile, khatmah history bars show completion, Insights type filter
  moved above the charts it filters, the hifz revision plan ("Suggested
  revision" card plus an 8 PM local nudge only when something due was
  missed), privacy policy at https://iqra.fly.dev/privacy (web repo
  `src/app/privacy/page.tsx`), App Review demo circle (Phase 5 cleanup, ids
  in HANDOFF Status).
- **Git**: `main` is pushed to github.com/danyalkn/iqra (public, owner's
  choice). The web repo `danyalkn/quran-tracker` is 5 commits ahead of its
  remote (privacy page, build marker, 3 older ones); push only if asked.
- **Supabase**: CLI linked as before. The Management API `logs.all`
  endpoint is gone and `/analytics/endpoints/logs` rejected `edge_logs`
  and returned backend errors on 2026-10-17; do not count on request logs
  for debugging.

## 1. Offline logging

### Today's behaviour (the limitation)

- Every write goes straight to Supabase: `insertEntry` / `updateEntry` /
  `deleteEntry` in `src/data/entryWrites.ts`, called from Today
  (`handleSave` in `src/app/(tabs)/today.tsx` ~559: optimistic temp row,
  removed on error), the Journal, Feed (delete), and the notification path
  (`performLog` in `src/push/actions.ts`, which also reads the profile,
  membership and recent entries online before it can build the entry).
- Offline: the optimistic row disappears with "Couldn't save"; a
  notification button answers "Couldn't log that. Tap to finish it in
  Iqra."; screens show their load-failed states (Today: "Couldn't load
  today"). Nothing is queued and nothing is cached.

### What to build

1. **Outbox for new entries.** A logged entry is written to a local queue
   (AsyncStorage via `src/storage/prefs.ts` or a dedicated module in
   `src/storage/`, per user) with a **client-generated id**, and shown at
   once with a quiet "Waiting to sync" mark. A sync loop sends queued rows
   oldest first and removes each on success. The insert policy only checks
   `user_id = auth.uid() and is_member(group_id)`, so the client may supply
   `id` (verified 2026-10-17); a retry of the same row then hits the
   primary key and can be treated as success, which makes the sync
   idempotent and lets `performLog` drop its tap-time lookup in favour of
   the id. UUID source: `crypto.getRandomValues` if Hermes provides it on
   RN 0.88 (check), else a small v4 generator in `src/lib` (pure); do NOT
   add `expo-crypto` unless the session is already making a native build.
2. **Entry building offline.** The sheet and the notification buttons need
   the profile (mode, mushaf, timezone), membership (group id) and recent
   entries (continuation of position, streak). Cache the last good copies
   per user and build from cache + pending outbox rows when offline, so
   "continue from last page" and the streak include entries not yet
   synced. `continuedEntry` in `src/lib/entryDefaults.ts` already takes
   the rows it continues from.
3. **Notification buttons offline** (`logInBackground` / `performLog`):
   enqueue instead of failing, confirm "Saved. It will sync when you're
   back online." (no em dashes), keep the `data.sendId` dedupe and the
   wrong-account / signed-out guards.
4. **Cached reads.** Today (entries, day reminders), Profile and the
   revision plan show the last loaded data offline with a small "Offline,
   showing saved data" line, and refresh when a request next succeeds.
   Feed and Insights may stay online-only in v1 if that keeps scope sane;
   say so in the copy rather than showing a broken state.
5. **Sync triggers.** App to foreground (AppState), after any request that
   succeeds, a short backoff timer while the queue is non-empty, and at the
   end of the headless notification path. Detecting "offline" can be done
   without a native module (a failed fetch is the signal); `expo-network`
   would add a reachability listener but is native, so only add it in a
   build that is happening anyway (the 1.1.0 Screen Time build), and read
   the SDK 58 docs first.
6. **After a sync**: `markEntriesChanged()` so Today, Feed and Insights
   refetch, reschedule the revision nudges (`refreshRevisionNudges`), and
   drop the "Waiting to sync" mark.

### Rules and decisions to settle (ask the owner where marked)

- **3 AM backdate window** (`log_entries_backdate_guard`, DECISIONS
  "Logging"): an entry stamped yesterday that only syncs after 3 AM is
  rejected with `check_violation` "Yesterday can only be logged until
  3 AM." Recommended: keep the server rule strict (the client clock cannot
  be trusted), keep `logged_at` as the time the member logged it, and on
  that rejection show the row as "Couldn't sync: yesterday closed at 3 AM"
  with Log for today / Discard. **Owner decision** if they want a grace
  for entries logged on time but synced late.
- **Edits and deletes**: recommended v1 scope is editing or deleting a row
  that is still in the outbox (purely local) plus online-only edits and
  deletes of synced rows with a clear "Needs a connection" message. Queuing
  edits and deletes of server rows (and their conflicts) can follow if the
  owner wants it.
- **Sign-out with a non-empty outbox**: warn "N entries haven't synced yet"
  and let the member choose to wait or discard; never silently drop them,
  and never let them sync into the next account (the queue is per user id).
- **Privacy**: cached rows are the member's own and their circle's data;
  clear every cache and the outbox on sign-out and account deletion.
- Shared-lib additions (a pure uuid helper, any outbox merge logic) go in
  `src/lib` and are native-only; note them in HANDOFF as before.

### Testing

Independent review (Opus) before device testing, as every phase so far.
On the owner's phone after the EAS update: airplane mode on, log from the
+ button and from a notification button (send the push first, then go
offline before tapping), check the "Waiting to sync" rows, the streak and
"continue from" text; airplane mode off, reopen, confirm each row landed
exactly once (`select ... from log_entries where user_id = ... order by
created_at desc`), and that Feed shows them. Also the 3 AM rejection path
(seed via a backdated outbox row in a test build or a throwaway account,
never the real circle).

### Offline logging: what was built (2026-10-17)

Code complete in commits 8c1a568..4a56f82, reviewed twice (Opus: 2 high
and 5 medium findings, then 5 smaller ones on the fixes; all fixed in the
`fix(...)` commits after 6db970d), migration 20261017180000 applied and
recorded. Shipped 2026-10-17 by EAS Update (iOS production group
4e807b4b, Android preview group 2ca0201d).

Simulator-verified 2026-10-17 with a throwaway account in the demo circle
(deleted afterwards, zero rows left): online log, continuation, edit and
delete through the outbox; then "offline" by serving the bundle with
`EXPO_PUBLIC_SUPABASE_URL=https://offline-test.invalid` (requests fail as
with no connection, the keychain session stays): the app opened on saved
data with "Offline, showing saved data.", a Sabak continued from the saved
rows and showed "Waiting to sync", an edit of it stayed local, and after a
kill and a relaunch against the real URL the entry landed exactly once
with `offline_logged_at` set and the edit applied. Sign-out cleared the
outbox and saved-copy keys. Not covered there (needs the phone): real
airplane mode, an access token older than an hour, notification buttons.

Decisions taken while building, refining the plan above:

- **3 AM window: owner chose a grace by offline time**, not the strict
  rule. `log_entries.offline_logged_at` is sent only once a first send has
  failed; the guard judges an insert by it when it is plausible (not in
  the future, at most 7 days old, not before `logged_at`), else by now().
  The 7-day bound was the session's call inside the owner's decision; the
  owner can change it. "Couldn't sync: yesterday closed" still exists for
  the leftovers (Log for today / Discard).
- **One write path.** Every new entry, online or not, goes through the
  outbox and is sent from there; the temp-id optimistic row is gone. A
  row says "saving…" until its first send fails, then "Waiting to sync"
  (still editable; the edit stays on the phone).
- **Exactly once.** Client uuid primary key; a 23505 on retry is read back
  by id, checked to be this member's, and the member's later edit is
  applied with an update. A discarded entry whose send ever failed is kept
  as a hidden discard and deleted on the server by id. Sends are cut off
  after 15 s and count as no connection.
- **Offline launch was broken before this work** (found while designing):
  with an access token older than an hour, supabase-js reports no session
  offline after retrying the refresh for ~25 s, so the app showed the
  splash, then the login screen; the profile read failure would also send
  an onboarded member to onboarding. Fixed: SessionProvider waits 2.5 s,
  then uses the keychain session (supabase-js keeps it for a later
  refresh); profile and membership come from saved copies first.
- **Guarded fetch** (`src/supabase/client.ts`): while a member is signed
  in, a REST request carrying the bare publishable key is failed as if
  offline. Without it RLS answers with an empty list and no error (offline,
  and for up to a minute after reconnecting while supabase-js caches a
  failed refresh), which would read as "nothing logged".
- **Saved copies** (`iqra:cache:<kind>:<userId>`): profile, circle, Today
  rows and reminders, hifz history. Today paints them at once and says
  "Offline, showing saved data." while reads fail. Feed, Insights, Chat
  and the Journal stay online-only (they already say "Check your
  connection").
- **Notification buttons** queue first (1.5 s look at fresh rows when
  saved copies exist), then wait up to 8 s for the send: "Logged ..." or
  "Saved ... It will sync when you're back online." Who is signed in comes
  from the keychain.
- **Triggers**: a new entry, a Today read that landed, foreground return,
  a 5 s to 60 s backoff while entries wait, pull to refresh, the end of a
  button log. No expo-network (native).
- **Sign-out** gives waiting entries one more send, then asks; it clears
  the outbox and every saved copy. A user change (e.g. a dead refresh
  token) clears the saved copies but keeps that member's outbox for when
  they sign back in.
- Accepted gaps from the second review: a button still writes its
  dedupe claim before its (at most 1.5 s, saved copies present) look at
  the network, so an iOS suspension in exactly that window loses the tap
  silently; queueing from saved copies before any network call would close
  it if the phone test shows losses. On a cold start slower than 4 s a
  deep link opens on the saved copy. A timed-out sign-out whose supabase-js
  call finishes after a different member signs in could revoke that
  member's session (needs a sign-in within seconds; not handled).
- Observation, not changed: iOS's own HTTP cache (`Library/Caches/
  .../fsCachedData`) keeps copies of Supabase responses after sign-out.
  Pre-existing; the app never writes it. A `cache: "no-store"` on the
  guarded fetch would stop it if the owner wants that.
- Accepted gaps: a button's "continue from" uses the rows this phone knows
  (the saved copy follows every change here, but a log from another device
  since the last read is missed); a revoked session leaves its outbox on
  the phone until that member signs back in.

## 2. Owner checks still open

1. **Locked-and-killed notification log**: swipe Iqra away, lock the
   phone, the agent sends a reading reminder (`select public.send_push(
   array['<uid>']::uuid[], jsonb_build_object('title','Iqra','body','...',
   'url','/today?log=reading','tag','reminder','category','logReading'))`),
   the owner taps Log 1 page from the lock screen, the agent checks
   `log_entries`. Two test pushes on 2026-10-17 20:14 and 20:18 UTC wrote
   nothing; the owner had not said whether they tapped. If this state loses
   writes, PHASE4.md option B (hold a background task, native, 1.1.0).
2. **Revision nudge**: confirm the 8 PM "Revision suggestion" fires only
   when something due is still unrevised, and not after logging it.
3. **Family Controls (Distribution) requests**: four, filed by the Account
   Holder, exact ids and text in `docs/SCREEN-TIME.md` (the monitor
   extension is `.ActivityMonitorExtension`). Not confirmed filed.
4. **TestFlight public link** for the circle; Test Information > Privacy
   Policy URL (optional but cheap).
5. **Android push**: Firebase project, `google-services.json`, FCM V1 key
   via `eas credentials` (needs the owner's Google login once).
6. Later: **Unlisted App Store distribution** (no orange beta dot, no
   90-day expiry); App Privacy answers are in PHASE4.md ship step 6.
7. Open product question: member 39587991 is on Juz 29 and may memorize
   backwards; the revision plan's "previous juz" fallback assumes forwards
   (current - 1). Ask before changing.

## 3. Phase 4 Screen Time

Unchanged from `docs/PHASE4.md` § 3 and `docs/SCREEN-TIME.md`, with the
research done 2026-10-17: `react-native-device-activity` 0.6.1 (last
release 2026-02-19, peers allow SDK 58, untested on 55+ by anyone in its
issues), extension targets `ActivityMonitorExtension`, `ShieldConfiguration`,
`ShieldAction`, all with Family Controls + the App Group
`group.com.qadamtechnologies.iqra`; Team ID 69BV989JDV goes in
`ios.appleTeamId`. Build with the Development entitlement on a dev client
until Apple approves; ship in the 1.1.0 build. Android counterpart:
`expo-app-blocker` 0.1.77 (Android parts only; its iOS targets would clash).

## Kickoff brief for the next session (paste as the first message)

```
I'm continuing the Iqra native app (Expo SDK 58, Expo Router, React 19,
RN 0.88). Version 1.0.0 is on TestFlight and an Android APK is out; JS
fixes ship by EAS Update to production (iOS) and preview (Android).

Read in this order before touching anything: CLAUDE.md, docs/NEXT-SESSION.md
(this handoff: state, the offline-logging plan, open owner checks, Screen
Time), docs/DECISIONS.md ("Logging", "Revision plan"), docs/PHASE3.md
"Progress and decisions made while building", docs/SCREEN-TIME.md. The SDK
58 docs and node_modules types are the truth for every Expo API.

Main job: offline logging. Logging from the app or from a notification
button must work with no connection: save to a per-user outbox with a
client-generated id, show it as waiting to sync, sync automatically and
exactly once when back online, and show cached data on Today offline.
Follow section 1 of NEXT-SESSION.md, ask me only the decisions it marks as
mine (the 3 AM window grace), and stay JS-only unless a native build is
happening anyway.

Rules: single thread of decisions; Sonnet or Opus subagents for research,
review and scoped fixes, never Haiku, and look over their outcomes; an
independent review before device testing. src/lib stays RN-free. No em
dashes anywhere. Commit per concern with a body that says why; do not push
unless I ask. npx tsc --noEmit and npx expo lint before calling anything
done. My phone runs the TestFlight build, so test with an EAS update, not
Metro. If a step needs my credentials or my phone, ask me once; otherwise
do it and report. Then the open owner checks in section 2, then Phase 4.
```
