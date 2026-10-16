-- ════════════════════════════════════════════════════════════════════════
-- Iqra — chat reactions + replies (Instagram-style)
--   • messages.reply_to → quoted-reply threading
--   • message_reactions → one reaction per user per message (new replaces old)
--   • push: someone replying to your message notifies you like a mention
-- ════════════════════════════════════════════════════════════════════════

-- ── Replies ─────────────────────────────────────────────────────────────────
alter table public.messages
  add column if not exists reply_to uuid references public.messages (id)
    on delete set null;

-- Tighten message inserts: a reply must quote a message in the SAME group.
-- (The FK only proves the id exists; FK checks run as owner and bypass RLS, so
--  without this a member could quote a message from a group others can't read.)
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_member(group_id)
    and (
      reply_to is null
      or exists (
        select 1 from public.messages m
        where m.id = messages.reply_to
          and m.group_id = messages.group_id
      )
    )
  );

-- ── Reactions ───────────────────────────────────────────────────────────────
create table if not exists public.message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  -- denormalized so RLS + realtime filters don't need a join
  group_id   uuid not null references public.groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  -- IG semantics: one reaction per person per message; changing it replaces.
  unique (message_id, user_id)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);
create index if not exists message_reactions_group_idx
  on public.message_reactions (group_id, created_at desc);

-- DELETE realtime payloads need the full old row (group_id for the client
-- filter), not just the primary key.
alter table public.message_reactions replica identity full;

grant select, insert, update, delete on public.message_reactions to authenticated;

alter table public.message_reactions enable row level security;

-- Read reactions in your group.
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated
  using (public.is_member(group_id));

-- React as yourself, to a message that really is in that group.
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_member(group_id)
    and exists (
      select 1 from public.messages m
      where m.id = message_reactions.message_id
        and m.group_id = message_reactions.group_id
    )
  );

-- Change or remove only your own reaction.
drop policy if exists message_reactions_update on public.message_reactions;
create policy message_reactions_update on public.message_reactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- Stream reaction changes into the chat (guarded for re-runs).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;

-- ── Push: replies notify the original author like a mention ────────────────
-- Priority per recipient: mentioned > replied-to > everyone-else(notify_chat).
-- No pushes for reactions — deliberately quiet for a small group.
create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender    text;
  mentioned uuid[];
  replied   uuid[];
  others    uuid[];
  tag       text := 'chat-' || new.group_id;
begin
  select coalesce(display_name, 'Someone') into sender
  from profiles where id = new.user_id;

  -- @mentioned people always get notified (never the sender)
  mentioned := array_remove(new.mentions, new.user_id);

  -- the author of the message being replied to (unless they're the sender,
  -- already mentioned, or no longer a member of the group)
  if new.reply_to is not null then
    select array_agg(distinct m.user_id) into replied
    from messages m
    join group_members gm
      on gm.group_id = new.group_id and gm.user_id = m.user_id
    where m.id = new.reply_to
      and m.user_id <> new.user_id
      and not (m.user_id = any (coalesce(mentioned, '{}'::uuid[])));
  end if;

  -- everyone else in the group who hasn't muted normal messages
  select array_agg(gm.user_id) into others
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = new.group_id
    and gm.user_id <> new.user_id
    and not (gm.user_id = any (coalesce(mentioned, '{}'::uuid[])))
    and not (gm.user_id = any (coalesce(replied, '{}'::uuid[])))
    and coalesce(p.notify_chat, true);

  if array_length(mentioned, 1) is not null then
    perform public.send_push(
      mentioned,
      jsonb_build_object('title', sender || ' mentioned you',
                         'body', left(new.body, 140), 'url', '/chat', 'tag', tag));
  end if;

  if array_length(replied, 1) is not null then
    perform public.send_push(
      replied,
      jsonb_build_object('title', sender || ' replied to you',
                         'body', left(new.body, 140), 'url', '/chat', 'tag', tag));
  end if;

  if array_length(others, 1) is not null then
    perform public.send_push(
      others,
      jsonb_build_object('title', sender, 'body', left(new.body, 140),
                         'url', '/chat', 'tag', tag));
  end if;

  return new;
end;
$$;
