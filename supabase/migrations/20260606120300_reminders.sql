-- ════════════════════════════════════════════════════════════════════════
-- Iqra — reminders (multiple per user, time + days of week)
-- Times are LOCAL to the user's profile.timezone; the pg_cron push job
-- evaluates each user's local weekday + time. Supersedes profiles.reminder_time
-- (that column is left in place but no longer used by the app).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  time       time not null,
  -- days of week the reminder fires on: 0=Sun … 6=Sat. Default = every day.
  days       smallint[] not null default '{0,1,2,3,4,5,6}',
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists reminders_user_idx on public.reminders (user_id);

alter table public.reminders enable row level security;

grant select, insert, update, delete on public.reminders to authenticated;

-- Full access to your own reminders only.
drop policy if exists reminders_all on public.reminders;
create policy reminders_all on public.reminders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
