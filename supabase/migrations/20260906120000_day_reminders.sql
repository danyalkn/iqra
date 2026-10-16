-- ════════════════════════════════════════════════════════════════════════
-- Iqra - one-time day reminders ("remind me at 9 PM to do Dhor")
--
-- Owner direction (2026-09-06): set a one-off reminder for later today (or
-- tomorrow, for late-night planning) straight from the Today page, next to
-- logging. Distinct from the recurring time + days-of-week rows in
-- `reminders`, and deliberately built differently:
--
--   * Separate table, not a flag on `reminders`. Settings lists that table as
--     "Daily reminders", and cron_send_reminders() dedups `distinct on (user)`
--     with no per-row sent state, so one-off rows do not fit there.
--   * Every row carries its own sent/skipped mark: the "sent-log" that
--     20260829150000 noted the recurring job lacks. That is what lets this
--     job run every minute with no fixed window, deliver late within the same
--     local day after an outage, and sidestep the DST double-fire/skip
--     accepted for the recurring job. (Verified: a spring-forward gap time
--     resolves an hour later and fires once; a fall-back repeated time
--     resolves to its second occurrence and fires once. Known, accepted: a
--     relative quick pick made INSIDE the repeated fall-back hour stores that
--     ambiguous wall time and can therefore land an hour late, one hour a
--     year, only in zones that observe DST.)
--   * due_at (and expires_at, the end of that local day plus a little slack)
--     are frozen at insert time from the profile timezone (trigger), so a
--     later timezone edit neither moves nor orphans a reminder, and the
--     server, not the client, decides what "today or tomorrow" means and
--     rejects a time that has already passed.
--   * Quiet once the job is done, refined: a reminder FOR a specific entry
--     type is skipped when that same type was logged AFTER the reminder was
--     set, ON the reminder's own day. Unlike reading_snapshot().logged_today
--     (any entry, any type), a 7 AM Sabak must not silence a 9 PM Dhor
--     reminder, while a Dhor logged at 8 PM does; and a Sabak logged tonight
--     leaves tomorrow morning's Sabak reminder alone. General reminders (no
--     type) always send. The Today page shows the identical rule client-side
--     ("Logged"), so the silence is never a surprise; delete + set again
--     resets the anchor.
--   * Rows are claimed with UPDATE ... RETURNING before sending, so a manual
--     run beside the live job, or a cancel racing the tick, can neither
--     double-send nor push a reminder that no longer exists. sent_at means
--     "handed to the push queue", never "delivered" (same as every cron).
--   * Rows older than 7 days are purged by the same job. A per-minute job
--     also fills cron.job_run_details, so a small daily job trims that log
--     to a week (nothing had been trimming it for the 15-minute jobs either).
--   * A typed push deep-links to /today?log=<type>&r=<id>; the id lets the
--     Today page open the log sheet once and not again on Back or reload.
--   * No em dashes in any string a member reads.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.day_reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  remind_on   date not null,          -- local calendar date (profile.timezone)
  time        time not null,          -- local wall-clock time
  due_at      timestamptz not null,   -- frozen instant, set by the trigger
  expires_at  timestamptz not null,   -- end of its local day + slack, frozen too
  -- What it is for. Mirrors the log_entries CHECK and EntryType in
  -- src/lib/entries.ts. Null = a general reminder.
  entry_type  text
                check (entry_type is null or entry_type in
                  ('sabak', 'sabak_para', 'dor', 'reading', 'revising')),
  note        text check (note is null or char_length(note) <= 120),
  sent_at     timestamptz,            -- handed to the push queue
  skipped_at  timestamptz,            -- stayed quiet: already logged
  created_at  timestamptz not null default now(),
  check (sent_at is null or skipped_at is null)
);

-- Today page: this user's rows for today/tomorrow.
create index if not exists day_reminders_user_day_idx
  on public.day_reminders (user_id, remind_on);
-- Cron: the handful of pending rows, by due time.
create index if not exists day_reminders_pending_idx
  on public.day_reminders (due_at)
  where sent_at is null and skipped_at is null;

-- Clients insert and cancel; sent_at / skipped_at / due_at are server-owned,
-- so no UPDATE for authenticated (revoked explicitly too, in case a default
-- privilege ever hands it out). service_role gets the lot for verification.
grant select, insert, delete on public.day_reminders to authenticated;
revoke update on public.day_reminders from authenticated, anon;
grant select, insert, update, delete on public.day_reminders to service_role;

alter table public.day_reminders enable row level security;

drop policy if exists day_reminders_all on public.day_reminders;
create policy day_reminders_all on public.day_reminders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Insert guard: today or tomorrow, not in the past, due_at frozen ─────────
create or replace function public.day_reminders_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tz          text;
  local_today date;
begin
  select timezone into tz from profiles where id = new.user_id;
  if tz is null then
    raise exception 'Finish onboarding before setting a reminder.';
  end if;

  local_today := (now() at time zone tz)::date;
  if new.remind_on < local_today or new.remind_on > local_today + 1 then
    raise exception 'A one-time reminder must be for today or tomorrow.';
  end if;

  -- A day of reminders is a handful, not a queue. Caps accidental (or
  -- scripted) spam before it can become N pushes in one tick.
  if (select count(*) from day_reminders d
      where d.user_id = new.user_id
        and d.sent_at is null and d.skipped_at is null) >= 20 then
    raise exception 'That is plenty of reminders for one day.';
  end if;

  -- date + time is a naive local timestamp; pin it to the profile zone.
  new.due_at := (new.remind_on + new.time) at time zone tz;
  -- Last moment it may still go out: a late tick after an outage delivers
  -- tonight's reminder, but never a stale one tomorrow morning. Frozen here
  -- so the cap cannot drift away from due_at if the timezone is edited.
  new.expires_at := ((new.remind_on + 1)::timestamp at time zone tz)
                    + interval '10 minutes';
  -- Two minutes of slack for a slow tap; anything inside it just fires on
  -- the next tick, which is the friendly outcome.
  if new.due_at < now() - interval '2 minutes' then
    raise exception 'That time has already passed.';
  end if;

  -- Server-owned columns: a client can never pre-mark a row.
  new.sent_at    := null;
  new.skipped_at := null;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists trg_day_reminders_guard on public.day_reminders;
create trigger trg_day_reminders_guard
  before insert on public.day_reminders
  for each row execute function public.day_reminders_guard();

-- ── The job: skip what is done, claim what is due, send, tidy ───────────────
create or replace function public.cron_send_day_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  label text;
  body  text;
begin
  -- A week of history is plenty; Today only ever shows today and tomorrow.
  delete from day_reminders where remind_on < current_date - 7;

  -- 1. Quiet once the job is done: the reminder is FOR a type that was
  --    logged after it was set. Marked rather than deleted so Today can say
  --    "Logged" instead of the row silently vanishing.
  update day_reminders d
  set skipped_at = now()
  from profiles p
  where p.id = d.user_id
    and d.sent_at is null
    and d.skipped_at is null
    and d.due_at <= now()
    and d.entry_type is not null
    and exists (
      select 1 from log_entries le
      where le.user_id = d.user_id
        and le.entry_type = d.entry_type
        and le.logged_at > d.created_at
        -- ...and on the reminder's own day: a Sabak logged tonight must not
        -- silence tomorrow morning's Sabak reminder.
        and (le.logged_at at time zone p.timezone)::date = d.remind_on
    );

  -- 2. Claim and send in one statement. "Due" is simply that the instant has
  --    passed; "expired" that its local day is over (both frozen at insert).
  for r in
    update day_reminders d
    set sent_at = now()
    where d.sent_at is null
      and d.skipped_at is null
      and d.due_at <= now()
      and now() < d.expires_at
    returning d.id, d.user_id, d.entry_type, d.note
  loop
    -- Mirror of ENTRY_META labels in src/lib/entries.ts.
    label := case r.entry_type
      when 'sabak'      then 'Sabak'
      when 'sabak_para' then 'Sabak Para'
      when 'dor'        then 'Dhor'
      when 'reading'    then 'Reading'
      when 'revising'   then 'Revising'
    end;

    -- The member's own words first; otherwise a short nudge in house voice.
    body := coalesce(
      nullif(btrim(r.note), ''),
      case
        when r.entry_type is null       then 'Time for a little Quran.'
        when r.entry_type = 'reading'   then 'Time to read. Tap to log it.'
        when r.entry_type = 'revising'  then 'Time to revise. Tap to log it.'
        else 'Time for your ' || label || '. Tap to log it.'
      end
    );

    perform public.send_push(
      array[r.user_id],
      jsonb_build_object(
        'title', coalesce(label || ' reminder', 'Reminder'),
        'body',  body,
        -- Typed reminders deep-link straight into the log sheet for that
        -- type; the id lets the page open it exactly once.
        'url',   case when r.entry_type is null
                      then '/today'
                      else '/today?log=' || r.entry_type || '&r=' || r.id::text end,
        -- Per-row tag on purpose: two reminders the same evening must stack
        -- in the tray, not replace each other (public/sw.js collapses by tag).
        'tag',   'day-reminder:' || r.id::text
      )
    );
  end loop;
end;
$$;

-- Only pg_cron (running as the owner) may run the job: a client must not be
-- able to trigger a sweep over PostgREST's /rpc endpoint.
revoke execute on function public.cron_send_day_reminders() from public, anon, authenticated;

-- ── Schedule: every minute (the marks make the cadence a pure latency knob) ──
select cron.unschedule('iqra-day-reminders')
  where exists (select 1 from cron.job where jobname = 'iqra-day-reminders');
select cron.schedule('iqra-day-reminders', '* * * * *', $$select public.cron_send_day_reminders();$$);

-- ── Housekeeping: keep a week of pg_cron run history ─────────────────────────
-- pg_cron logs every run; at one a minute that is ~1,400 rows a day, and
-- nothing had been trimming the 15-minute jobs' rows either.
select cron.unschedule('iqra-cron-housekeeping')
  where exists (select 1 from cron.job where jobname = 'iqra-cron-housekeeping');
select cron.schedule('iqra-cron-housekeeping', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days';$$);
