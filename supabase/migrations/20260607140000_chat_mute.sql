-- ════════════════════════════════════════════════════════════════════════
-- Iqra — per-user "mute normal chat messages" setting
-- notify_chat = false → user is NOT pushed for ordinary messages, but STILL
-- gets @mentions (and reminders/nudges). Updates on_message_insert to honor it.
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists notify_chat boolean not null default true;

create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender    text;
  mentioned uuid[];
  others    uuid[];
  tag       text := 'chat-' || new.group_id;
begin
  select coalesce(display_name, 'Someone') into sender
  from profiles where id = new.user_id;

  -- @mentioned people always get notified (never the sender)
  mentioned := array_remove(new.mentions, new.user_id);

  -- everyone else in the group who hasn't muted normal messages
  select array_agg(gm.user_id) into others
  from group_members gm
  join profiles p on p.id = gm.user_id
  where gm.group_id = new.group_id
    and gm.user_id <> new.user_id
    and not (gm.user_id = any (coalesce(mentioned, '{}'::uuid[])))
    and coalesce(p.notify_chat, true);

  if array_length(mentioned, 1) is not null then
    perform public.send_push(
      mentioned,
      jsonb_build_object('title', sender || ' mentioned you',
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
