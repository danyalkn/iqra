-- ════════════════════════════════════════════════════════════════════════
-- Iqra - chat read receipts (IG style)
--
-- One row per member per group: the timestamp of the newest message they
-- have seen (a read FRONTIER, like Instagram/Messenger - not a row per
-- message). The client renders each member's tiny avatar under the last
-- message at or before their frontier, and moves it down as they read.
--
-- Privacy shape: frontiers are visible to the whole circle (that is the
-- feature), writable only by their owner.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.chat_reads (
  group_id     uuid not null references public.groups (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null,
  updated_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- The classic setup gotcha: RLS alone isn't enough, the role needs grants.
grant select, insert, update, delete on public.chat_reads to authenticated;
grant select, insert, update, delete on public.chat_reads to service_role;

alter table public.chat_reads enable row level security;

-- Everyone in the circle sees everyone's frontier...
drop policy if exists chat_reads_select on public.chat_reads;
create policy chat_reads_select on public.chat_reads
  for select to authenticated
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = chat_reads.group_id and gm.user_id = auth.uid()
    )
  );

-- ...but you only ever write your own.
drop policy if exists chat_reads_insert on public.chat_reads;
create policy chat_reads_insert on public.chat_reads
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = chat_reads.group_id and gm.user_id = auth.uid()
    )
  );

drop policy if exists chat_reads_update on public.chat_reads;
create policy chat_reads_update on public.chat_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Live over the same realtime pipe as messages/reactions. RLS applies to
-- realtime too, so frontiers only stream inside the member's own circle.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_reads'
  ) then
    alter publication supabase_realtime add table public.chat_reads;
  end if;
end
$$;
