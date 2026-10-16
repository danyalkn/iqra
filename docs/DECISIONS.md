# Iqra product decisions

These are owner decisions that are NOT derivable from the code and that
override the original build brief. They were made while building the web
PWA (June to October 2026) and carry over to the native app unchanged.
When the code and this file disagree, this file wins; ask the owner.

## Auth

- **Email + password, not OTP.** OTP needs an email-sending service forever,
  while group membership (RLS) is the real gate, so an unverified email is
  harmless. Supabase "Confirm email" is OFF. There is no email service at
  all. Password resets are done by the owner in the Supabase dashboard.
- Sign-up has confirm-email and confirm-password fields; paste is allowed.
- Members are added to a circle by the owner with `supabase/admin_examples.sql`.
  There is no in-app invite flow and none is planned.

## Logging

- **Units are page / quarter / hizb / juz / ayah.** "Lines" was dropped.
- **Quarter = 5 pages** (quarter of a juz, NOT rub' al-hizb).
- Pages accept decimals (0.5).
- `pages_equiv` is a generated column: page x1, quarter x5, hizb x10, juz x20,
  ayah -> null (ayahs are counted separately).
- **Modes:** `reading` and `hifz`. Hifz entry types are Sabak, Sabak Para,
  Dhor, shown with plain-language meanings. Reading mode has reading and
  revising. Every type counts toward the group khatmah.
- **Hifz position lives in `log_entries.from_ref`**, not a new column:
  juz-relative start page in quarter steps ("3.5" = second half of page 3 of
  that juz). Parsed by `src/lib/position.ts`. Chosen because migrations could
  not be pushed from the dev machine and hifz rows never used `from_ref`.
  Do not "fix" this with a migration without asking.
- **Mushaf selection:** per profile (`profiles.mushaf`, default `uthmani15`),
  and stamped on each entry so bookmarks read correctly for everyone.
  Writes retry without the `mushaf` column if it is missing (legacy guard,
  can be dropped once the native app is the only client).
- **Backdating closes at 3 AM.** "Yesterday" is loggable only from midnight
  to 03:00 profile-local time (it was being used as a streak cheat code).
  Enforced by trigger `log_entries_backdate_guard` (auth.uid() null = owner
  or SQL editor bypass) and mirrored in the log sheet UI.
- Edits never change `logged_at`.

## Reminders

- **Recurring reminders are a separate `reminders` table** (multiple per
  user, time + days-of-week, in `profiles.timezone`). Managed in Settings.
  `profiles.reminder_time` is deprecated and unused.
- **One-time day reminders** (`day_reminders` table) are set from the Today
  page for later today or tomorrow. `due_at` is frozen by a BEFORE INSERT
  trigger in profile tz (rejects past times). Cron `cron_send_day_reminders`
  runs every minute, claims rows with UPDATE...RETURNING, skips a typed
  reminder only when the SAME entry type was logged after `created_at`
  (untyped always sends), same-local-day cap +10 min, purges after 7 days.
  Push deep-links to `/today?log=<type>&r=<id>`.
- Reminder copy is personalized server-side (streak / bookmark / surah /
  morning-vs-evening pools + rotating tips via `reading_snapshot()` and
  `pick_line()`), and skipped when already logged today.
- Known and accepted: DST 1 to 3 AM reminders can double-fire or skip.

## Notifications (revised 2026-08-29)

Push fires for:

- every chat message, to the whole circle except the sender (@mentioned
  people get a "mentioned you" variant; `@all` mentions everyone, including
  people who muted chat),
- reminders (recurring and one-time),
- nudges (someone nudged you; same person can nudge again after 15 s),
- the **sunset lapse nudge**: every day a member has not logged, one push at
  local sunset ("You haven't logged in X days"), daily for 30 silent days
  then weekly. `cron_lapsed_nudges()`, NOAA sunset per tz, 19:30 fallback,
- the **streak grace nudge**: `cron_streak_grace_nudge()` fires 00:00 to
  00:14 local to anyone whose streak ran through the day before but who
  logged nothing yesterday (pairs with the 3 AM backdating window),
- the **Sunday 20:00 local recap** push, deep-linking to `/stats#recap`.

Push NEVER fires for someone else's logging activity. `cron_streak_at_risk()`
exists but stays unscheduled (superseded by the lapse nudge).

- **No showing off.** No milestone or leaderboard pushes, no member-vs-member
  comparisons in pushes or personal insights. The in-app group leaderboard
  stays; the recap push, recap card and all "mine" insights are personal-only.
- Chat can be muted per user (`profiles.notify_chat`); `@all` overrides mute.

## Chat

- Reactions (Instagram quick set, in that order), replies, @mentions with
  highlighting, read receipts (`chat_reads` frontier per member), copy,
  search, long-press menu, swipe-to-reply.
- Realtime via Supabase `postgres_changes`. There is no replay, so every
  (re)join resyncs via REST. Realtime timestamps can arrive WITHOUT a tz
  offset and must be parsed as UTC. See `reference/web-pwa/app/(app)/chat/ChatClient.tsx`
  for the reconnect logic that was fought through; port it, do not rewrite.

## Stats

- Group khatmah counts every entry type, summed as Uthmani pages.
- Insights engine is `src/lib/insights.ts` (pure, shared). Personal scope
  only, see "No showing off".
- Chart ramp: Sabak -> Sabak Para -> Dhor is one hue, new to oldest.

## Design

- "Paper & Pine" tokens (`src/constants/theme.ts`). Light and dark, with a
  manual theme toggle in Settings in addition to system.
- Celebration (confetti + encouragement card) on logging, with a toggle to
  turn it off in Settings.
- iOS-feel everywhere: native tab bar, sheets that swipe down to dismiss,
  wheel pickers for amounts, haptics on log.
- No em dashes in any copy.

## Operations

- Supabase project `uqsdzraczxkinvefrbog`. Tables need
  `grant select,insert,update,delete ... to authenticated` or you get
  "permission denied for table" (RLS alone is not enough).
- Migrations are applied by pasting into the SQL editor (the CLI on the dev
  machine is on the wrong account; `db push` and `db query --linked` 403).
- Verified-SQL pattern that works via the Management API: run
  `begin; <sql>; do $$ ... raise exception 'RESULTS %' ... $$` in one script
  so the transaction rolls back and the full result text comes back.
- The web PWA is on Fly (`iqra.fly.dev`, region yyz, suspends when idle).
  Retire it once every member has installed the native app.
