-- Review hardening for 20261021200000: a picture's path is exactly
-- "<the message's group id>/<uuid>.jpg", and an upload may not nest
-- folders under the group. No leak was possible either way (readers still
-- need to be members of the group in the path); this keeps the bucket tidy.
alter table public.messages drop constraint if exists messages_image_path_in_group;
alter table public.messages
  add constraint messages_image_path_in_group
  check (
    image_path is null
    or image_path ~ ('^' || group_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  );

drop policy if exists chat_images_insert on storage.objects;
create policy chat_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and owner = auth.uid()
    and array_length(storage.foldername(name), 1) = 1
    and public.is_member(((storage.foldername(name))[1])::uuid)
  );
