-- ════════════════════════════════════════════════════════════════════════
-- Iqra — schema (tables, indexes, generated columns, realtime)
-- RLS policies live in the next migration (…_rls.sql).
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ── profiles ──────────────────────────────────────────────────────────────
-- One row per auth user. display_name is set during onboarding (app inserts
-- the row; there is no trigger that creates it). mode drives the log options
-- and default charts.
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  avatar_url    text,
  timezone      text not null default 'UTC',
  reminder_time time,
  mode          text not null default 'reading'
                  check (mode in ('hifz', 'reading')),
  created_at    timestamptz not null default now()
);

-- ── groups ────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ── group_members ─────────────────────────────────────────────────────────
-- Membership is the access gate for everything. Rows are inserted MANUALLY by
-- the owner (service role / SQL). There is intentionally no policy or trigger
-- that adds a signup to a group — a brand-new account sees nothing.
create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx
  on public.group_members (user_id);

-- ── log_entries ───────────────────────────────────────────────────────────
-- Multiple entries per day are allowed (no unique-per-day constraint).
--   from_ref / to_ref  = WHAT was covered (free text, no validation)
--   amount + unit      = HOW MUCH
--   pages_equiv        = amount normalized to "pages" for cross-unit rollups
--                        (Madani 604-page mushaf). Ayahs are NOT page-
--                        convertible, so their pages_equiv is null and they
--                        are summed separately by querying unit = 'ayah'.
create table if not exists public.log_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  group_id    uuid not null references public.groups (id) on delete cascade,
  logged_at   timestamptz not null default now(),
  entry_type  text not null
                check (entry_type in
                  ('sabak', 'sabak_para', 'dor', 'reading', 'revising')),
  from_ref    text,
  to_ref      text,
  amount      numeric check (amount is null or amount >= 0),
  unit        text check (unit in ('page', 'quarter', 'hizb', 'juz', 'ayah')),
  pages_equiv numeric generated always as (
    case unit
      when 'page'    then amount
      when 'quarter' then amount * 5
      when 'hizb'    then amount * 10
      when 'juz'     then amount * 20
      else null            -- 'ayah' or no unit → not counted in page rollups
    end
  ) stored,
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists log_entries_user_logged_idx
  on public.log_entries (user_id, logged_at desc);
create index if not exists log_entries_group_logged_idx
  on public.log_entries (group_id, logged_at desc);

-- ── messages (single shared group chat) ─────────────────────────────────────
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_group_created_idx
  on public.messages (group_id, created_at desc);

-- ── nudges ──────────────────────────────────────────────────────────────────
create table if not exists public.nudges (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_user    uuid not null references auth.users (id) on delete cascade,
  kind       text,
  created_at timestamptz not null default now()
);

-- For the ~1/recipient/day rate-limit check.
create index if not exists nudges_to_user_created_idx
  on public.nudges (to_user, created_at desc);

-- ── push_subscriptions ──────────────────────────────────────────────────────
-- One row per browser/device push subscription. Unique by endpoint so a
-- re-subscribe upserts rather than duplicates.
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  subscription jsonb not null,
  endpoint     text generated always as (subscription ->> 'endpoint') stored,
  created_at   timestamptz not null default now()
);

create unique index if not exists push_subscriptions_endpoint_key
  on public.push_subscriptions (endpoint);
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Chat (messages), the live feed (log_entries), and nudges stream over
-- Supabase Realtime. RLS still applies to realtime, so members only receive
-- rows from their own group. Guarded so re-running the migration is safe.
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'log_entries', 'nudges'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
