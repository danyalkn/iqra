-- ════════════════════════════════════════════════════════════════════════
-- Iqra — Row Level Security
-- Membership is the gate. A brand-new account with no group_members row sees
-- ZERO rows everywhere except its own profile / push subscriptions.
-- ════════════════════════════════════════════════════════════════════════

-- ── Helper functions (SECURITY DEFINER → bypass RLS, avoid recursion) ───────
-- These read group_members from inside policies. Marking them SECURITY DEFINER
-- means they do NOT re-trigger RLS on group_members, which would otherwise
-- recurse. search_path is pinned for safety.

-- Is the current user a member of group :gid ?
create or replace function public.is_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from group_members gm
    where gm.group_id = gid
      and gm.user_id = auth.uid()
  );
$$;

-- Does the current user share at least one group with user :uid ?
create or replace function public.shares_group(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from group_members me
    join group_members them on them.group_id = me.group_id
    where me.user_id = auth.uid()
      and them.user_id = uid
  );
$$;

revoke all on function public.is_member(uuid) from public;
revoke all on function public.shares_group(uuid) from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.shares_group(uuid) to authenticated;

-- ── Table privileges ────────────────────────────────────────────────────────
-- RLS controls WHICH ROWS; these GRANTs control whether the role may touch the
-- table at all. Without them you get "permission denied for table …". Row
-- access is still fully gated by the policies below. Only `authenticated` —
-- anon (logged-out) gets nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.groups,
  public.group_members,
  public.log_entries,
  public.messages,
  public.nudges,
  public.push_subscriptions
to authenticated;

-- ── Enable RLS on every table ───────────────────────────────────────────────
alter table public.profiles            enable row level security;
alter table public.groups              enable row level security;
alter table public.group_members       enable row level security;
alter table public.log_entries         enable row level security;
alter table public.messages            enable row level security;
alter table public.nudges              enable row level security;
alter table public.push_subscriptions  enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Read your own + anyone you share a group with. Insert/update only your own.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_group(id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- (no delete policy — account deletion is done via an Edge Function using the
--  service role, which cascades from auth.users.)

-- ── groups ──────────────────────────────────────────────────────────────────
-- Read groups you belong to. No client writes (owner manages via service role).
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select to authenticated
  using (public.is_member(id));

-- ── group_members ───────────────────────────────────────────────────────────
-- Read the membership of groups you're in (to render the roster / feed).
-- NO insert/update/delete policy → users cannot add themselves to a group.
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select to authenticated
  using (public.is_member(group_id));

-- ── log_entries ─────────────────────────────────────────────────────────────
-- Read ALL entries in your group (the accountability point).
-- Insert/update/delete only your own rows.
drop policy if exists log_entries_select on public.log_entries;
create policy log_entries_select on public.log_entries
  for select to authenticated
  using (public.is_member(group_id));

drop policy if exists log_entries_insert on public.log_entries;
create policy log_entries_insert on public.log_entries
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(group_id));

drop policy if exists log_entries_update on public.log_entries;
create policy log_entries_update on public.log_entries
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists log_entries_delete on public.log_entries;
create policy log_entries_delete on public.log_entries
  for delete to authenticated
  using (user_id = auth.uid());

-- ── messages ────────────────────────────────────────────────────────────────
-- Read all messages in your group; insert as yourself; delete only your own.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_member(group_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(group_id));

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (user_id = auth.uid());

-- ── nudges ──────────────────────────────────────────────────────────────────
-- Read nudges in your group; insert only with from_user = you (to a fellow
-- member). No update/delete from clients.
drop policy if exists nudges_select on public.nudges;
create policy nudges_select on public.nudges
  for select to authenticated
  using (public.is_member(group_id));

drop policy if exists nudges_insert on public.nudges;
create policy nudges_insert on public.nudges
  for insert to authenticated
  with check (
    from_user = auth.uid()
    and public.is_member(group_id)
    -- recipient must also be a member of the same group:
    and exists (
      select 1 from group_members gm
      where gm.group_id = nudges.group_id and gm.user_id = nudges.to_user
    )
  );

-- ── push_subscriptions ──────────────────────────────────────────────────────
-- Full access to your own rows only. No access to anyone else's.
drop policy if exists push_subscriptions_all on public.push_subscriptions;
create policy push_subscriptions_all on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
