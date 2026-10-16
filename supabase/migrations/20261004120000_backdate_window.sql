-- ════════════════════════════════════════════════════════════════════════
-- Iqra — "yesterday" closes at 3 AM, plus a midnight streak heads-up
-- (owner ask, 2026-10-04).
--
-- Logging for yesterday used to be open all day, which let a broken streak
-- be patched the next afternoon. Now:
--
--  1. log_entries_backdate_guard: an entry may be dated to the previous
--     local day only while it is still before 03:00 in the member's
--     profile timezone (people often read past midnight). Anything older
--     than yesterday is always rejected. Applies to inserts and to any
--     update that moves logged_at. Requests with no signed-in user (the
--     owner in the SQL editor, service-role jobs) are not limited.
--
--  2. cron_streak_grace_nudge: at local midnight, anyone whose streak ran
--     through the day before yesterday but who logged nothing yesterday
--     gets one push: did you read and forget to log? You have until 3 AM.
--     Runs every 15 minutes and fires in each member's 00:00–00:14 window.
--
-- The app mirrors rule 1 (the "Yesterday" option only shows before 3 AM);
-- this trigger is the real gate.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Backdate guard ──────────────────────────────────────────────────────
create or replace function public.log_entries_backdate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  local_now timestamp;
  entry_day date;
begin
  if auth.uid() is null then
    return new; -- owner / service role: unrestricted
  end if;
  if tg_op = 'UPDATE' and new.logged_at is not distinct from old.logged_at then
    return new; -- an edit that keeps the date is always fine
  end if;

  select coalesce(p.timezone, 'UTC') into tz from profiles p where p.id = new.user_id;
  tz := coalesce(tz, 'UTC');
  local_now := now() at time zone tz;
  entry_day := (new.logged_at at time zone tz)::date;

  if entry_day >= local_now::date then
    return new; -- today (or a clock a little ahead)
  end if;
  if entry_day = local_now::date - 1 and local_now::time < time '03:00' then
    return new; -- yesterday, still inside the grace window
  end if;
  raise exception 'Yesterday can only be logged until 3 AM.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists log_entries_backdate_guard on public.log_entries;
create trigger log_entries_backdate_guard
  before insert or update of logged_at on public.log_entries
  for each row execute function public.log_entries_backdate_guard();

-- ── 2. Midnight streak heads-up ────────────────────────────────────────────
create or replace function public.cron_streak_grace_nudge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  streak int;
  d date;
begin
  for r in
    select
      p.id,
      p.timezone,
      (now() at time zone p.timezone)::date as local_today
    from profiles p
    where (now() at time zone p.timezone)::time < time '00:15'
  loop
    -- Nothing logged yesterday...
    continue when exists (
      select 1 from log_entries le
      where le.user_id = r.id
        and (le.logged_at at time zone r.timezone)::date = r.local_today - 1
    );
    -- ...but a streak running up to the day before.
    streak := 0;
    d := r.local_today - 2;
    while exists (
      select 1 from log_entries le
      where le.user_id = r.id
        and (le.logged_at at time zone r.timezone)::date = d
    ) loop
      streak := streak + 1;
      d := d - 1;
    end loop;
    continue when streak = 0;

    perform public.send_push(
      array[r.id],
      jsonb_build_object(
        'title', 'Iqra',
        'body', format(
          'Nothing logged for %s, and your streak is %s %s. Read and forgot to log it? You have until 3 AM to add it under Yesterday.',
          trim(to_char(r.local_today - 1, 'Day')),
          streak,
          case when streak = 1 then 'day' else 'days' end
        ),
        'url', '/today',
        'tag', 'streak-grace'
      )
    );
  end loop;
end;
$$;

-- Only pg_cron may run the sweep (not clients over /rpc).
revoke execute on function public.cron_streak_grace_nudge() from public, anon, authenticated;

select cron.unschedule('iqra-streak-grace')
  where exists (select 1 from cron.job where jobname = 'iqra-streak-grace');
select cron.schedule('iqra-streak-grace', '*/15 * * * *', $$select public.cron_streak_grace_nudge();$$);
