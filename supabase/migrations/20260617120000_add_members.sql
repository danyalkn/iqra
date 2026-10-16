-- ════════════════════════════════════════════════════════════════════════
-- Iqra — owner-only "add member" flow
-- Lets the group owner search the user directory and add people to the group,
-- from inside the app. Gated to role = 'owner'; the creator of each group (its
-- earliest member) is promoted to owner here.
-- ════════════════════════════════════════════════════════════════════════

-- Promote each group's earliest member (its creator) to owner.
update public.group_members gm
set role = 'owner'
where gm.role <> 'owner'
  and gm.joined_at = (
    select min(j.joined_at)
    from public.group_members j
    where j.group_id = gm.group_id
  );

-- Search the user directory by name or email. Owner-only; returns whether each
-- person is already in the group so the UI can show "Added".
create or replace function public.search_users(p_group_id uuid, q text)
returns table (
  id           uuid,
  display_name text,
  avatar_url   text,
  email        text,
  is_member    boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role = 'owner'
  ) then
    raise exception 'Only the group owner can search members';
  end if;

  if coalesce(btrim(q), '') = '' then
    return;
  end if;

  return query
  select p.id,
         p.display_name,
         p.avatar_url,
         u.email::text,
         exists(
           select 1 from group_members m
           where m.group_id = p_group_id and m.user_id = p.id
         ) as is_member
  from profiles p
  join auth.users u on u.id = p.id
  where p.display_name ilike '%' || q || '%'
     or u.email ilike '%' || q || '%'
  order by is_member, p.display_name
  limit 20;
end;
$$;

-- Add a person to the group. Owner-only; idempotent.
create or replace function public.add_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.role = 'owner'
  ) then
    raise exception 'Only the group owner can add members';
  end if;

  insert into group_members (group_id, user_id, role)
  values (p_group_id, p_user_id, 'member')
  on conflict (group_id, user_id) do nothing;
end;
$$;

grant execute on function public.search_users(uuid, text) to authenticated;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;
