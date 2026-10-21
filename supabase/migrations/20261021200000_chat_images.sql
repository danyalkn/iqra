-- Pictures in the circle chat (owner, 2026-10-21): a message may carry one
-- JPEG, compressed on the phone before upload (long edge 1600 px, quality
-- 0.8, EXIF stripped), stored in Supabase Storage and never on Fly. Only
-- members of the group can read or write under the group's folder.
--
-- Web PWA (frozen): it reads messages with select("*") and shows `body`,
-- so a picture-only message renders as an empty bubble there; the native
-- app is the one that shows the picture. Nothing the web reads is renamed.

-- ── messages ────────────────────────────────────────────────────────────────
alter table public.messages
  add column if not exists image_path text,
  add column if not exists image_w   smallint,
  add column if not exists image_h   smallint;

-- A picture lives under its own group: "<group id>/<uuid>.jpg".
alter table public.messages drop constraint if exists messages_image_path_in_group;
alter table public.messages
  add constraint messages_image_path_in_group
  check (image_path is null or image_path like group_id::text || '/%');

-- ── bucket ──────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Members read their group's pictures, write only into their own group's
-- folder as themselves, and remove only what they uploaded.
drop policy if exists chat_images_select on storage.objects;
create policy chat_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-images'
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists chat_images_insert on storage.objects;
create policy chat_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and owner = auth.uid()
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists chat_images_delete on storage.objects;
create policy chat_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-images' and owner = auth.uid());

-- ── push: say it is a picture ───────────────────────────────────────────────
-- Same function as 20260704120000 with one change: the notification body
-- reads "Photo" or "Photo: <caption>" for a picture, instead of the empty
-- or caption-only body.
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
  preview   text;
begin
  select coalesce(display_name, 'Someone') into sender
  from profiles where id = new.user_id;

  if new.image_path is not null then
    preview := case when coalesce(new.body, '') = '' then 'Photo'
                    else 'Photo: ' || left(new.body, 130) end;
  else
    preview := left(new.body, 140);
  end if;

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
                         'body', preview, 'url', '/chat', 'tag', tag));
  end if;

  if array_length(replied, 1) is not null then
    perform public.send_push(
      replied,
      jsonb_build_object('title', sender || ' replied to you',
                         'body', preview, 'url', '/chat', 'tag', tag));
  end if;

  if array_length(others, 1) is not null then
    perform public.send_push(
      others,
      jsonb_build_object('title', sender, 'body', preview,
                         'url', '/chat', 'tag', tag));
  end if;

  return new;
end;
$$;
