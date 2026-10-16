-- ════════════════════════════════════════════════════════════════════════
-- Iqra — notify the whole group on every chat message
-- Replaces on_message_insert: previously only @mentioned users were pushed.
-- Now everyone in the group (except the sender) gets a notification; mentioned
-- people get a "mentioned you" variant. (Run after 20260606120500_push.sql.)
-- ════════════════════════════════════════════════════════════════════════

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

  -- people explicitly @mentioned (never the sender)
  mentioned := array_remove(new.mentions, new.user_id);

  -- everyone else in the group (not the sender, not already mentioned)
  select array_agg(gm.user_id) into others
  from group_members gm
  where gm.group_id = new.group_id
    and gm.user_id <> new.user_id
    and not (gm.user_id = any (coalesce(mentioned, '{}'::uuid[])));

  if array_length(mentioned, 1) is not null then
    perform public.send_push(
      mentioned,
      jsonb_build_object(
        'title', sender || ' mentioned you',
        'body',  left(new.body, 140),
        'url',   '/chat',
        'tag',   tag
      )
    );
  end if;

  if array_length(others, 1) is not null then
    perform public.send_push(
      others,
      jsonb_build_object(
        'title', sender,
        'body',  left(new.body, 140),
        'url',   '/chat',
        'tag',   tag
      )
    );
  end if;

  return new;
end;
$$;
