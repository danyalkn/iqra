-- ════════════════════════════════════════════════════════════════════════
-- Iqra — admin snippets (run in the Supabase SQL Editor as the owner)
-- Membership is granted MANUALLY here. There is no self-join from the app.
-- ════════════════════════════════════════════════════════════════════════

-- 1) Create your group (once). Note the returned id.
insert into public.groups (name)
values ('The Circle')
returning id;

-- 2) Add a member by their email (they must have signed up first, so a row
--    exists in auth.users). Replace the group id + email.
insert into public.group_members (group_id, user_id, role)
select '00000000-0000-0000-0000-000000000000'::uuid,  -- <- group id
       u.id,
       'member'
from auth.users u
where u.email = 'friend@example.com'
on conflict (group_id, user_id) do nothing;

-- Make yourself the admin (optional role label):
-- update public.group_members set role = 'admin'
-- where group_id = '...' and user_id = (select id from auth.users where email = 'you@example.com');

-- 3) See who is in a group:
-- select gm.role, p.display_name, u.email
-- from public.group_members gm
-- join auth.users u on u.id = gm.user_id
-- left join public.profiles p on p.id = gm.user_id
-- where gm.group_id = '...';

-- 4) Remove a member:
-- delete from public.group_members
-- where group_id = '...' and user_id = (select id from auth.users where email = 'ex@example.com');

-- 5) Give a locked-out member a temporary password (there is no email
--    service, so no reset link can be sent). They sign in with it, then pick
--    their own in the app: Profile, Settings, Reset password. Their existing
--    sessions (e.g. the web app) stay signed in. pgcrypto lives in the
--    `extensions` schema on Supabase; bcrypt is what Supabase Auth verifies.
-- update auth.users
-- set encrypted_password = extensions.crypt('temporary-password', extensions.gen_salt('bf')),
--     updated_at = now()
-- where email = 'friend@example.com';

-- ── Sanity check: a brand-new (membership-less) account sees nothing ────────
-- Run impersonating a user (Supabase SQL editor: set request.jwt.claims).
-- With no group_members row, every one of these must return 0 rows except the
-- user's own profile:
--   select * from public.log_entries;   -- 0
--   select * from public.messages;      -- 0
--   select * from public.group_members; -- 0
--   select * from public.groups;        -- 0
