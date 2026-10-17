-- ════════════════════════════════════════════════════════════════════════
-- Iqra: entries logged offline keep their day (owner, 2026-10-17).
--
-- The native app queues an entry that cannot be sent and sends it when the
-- phone is back online, dated when the member logged it. An entry logged at
-- 23:50 and sent at 08:00 is dated yesterday by then, and the 3 AM backdate
-- guard (20261004120000) refused it. The owner's call: record when it was
-- logged offline and judge it by that.
--
--  1. log_entries.offline_logged_at: the device time the member saved the
--     entry, sent only for an entry whose first send failed. Null for every
--     entry that went straight through and for everything the web app
--     writes, so it also marks exactly the entries that were logged offline.
--
--  2. log_entries_backdate_guard: on insert, an entry that carries
--     offline_logged_at is judged as if it had arrived at that time (still
--     never older than the day before, and yesterday only until 03:00 then).
--     The time comes from the phone's clock and cannot be checked, so it
--     only counts when it is plausible: not in the future (5 minutes of
--     slack), at most 7 days old, and not before the entry's own logged_at
--     (an entry is saved when it is logged, or later when backdated).
--     Otherwise the entry is judged by now() as before, so a crafted
--     offline time cannot backdate past that. Updates use now(), as before
--     (edits never move logged_at anyway).
--
-- Additive only: the web PWA never sends the column and reads it as one
-- more field of select *.
-- ════════════════════════════════════════════════════════════════════════

alter table public.log_entries
  add column if not exists offline_logged_at timestamptz;

comment on column public.log_entries.offline_logged_at is
  'Device time the entry was saved while offline (native outbox). Null when it was sent at once. The backdate guard judges an insert by it.';

create or replace function public.log_entries_backdate_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tz text;
  judged_at timestamptz := now();
  local_now timestamp;
  entry_day date;
begin
  if auth.uid() is null then
    return new; -- owner / service role: unrestricted
  end if;
  if tg_op = 'UPDATE' and new.logged_at is not distinct from old.logged_at then
    return new; -- an edit that keeps the date is always fine
  end if;

  if tg_op = 'INSERT'
     and new.offline_logged_at is not null
     and new.offline_logged_at <= now() + interval '5 minutes'
     and new.offline_logged_at >= now() - interval '7 days'
     and new.logged_at <= new.offline_logged_at + interval '5 minutes' then
    judged_at := new.offline_logged_at; -- as if it had arrived then
  end if;

  select coalesce(p.timezone, 'UTC') into tz from profiles p where p.id = new.user_id;
  tz := coalesce(tz, 'UTC');
  local_now := judged_at at time zone tz;
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
