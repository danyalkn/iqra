-- ════════════════════════════════════════════════════════════════════════
-- Iqra — push wiring (pg_cron reminders + @mention trigger → send-push)
--
-- PREREQUISITES (do these first, once):
--   1. Deploy the Edge Function:  supabase functions deploy send-push
--      and set its secrets (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT).
--   2. Enable extensions (Dashboard → Database → Extensions, or below):
--        pg_cron, pg_net   (and supabase_vault, usually on by default)
--   3. Store two secrets in Vault so this SQL can call the function:
--        select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--        select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
--
-- Notification policy: pushes fire for @mentions and reminders only — never
-- for feed/logging activity. (Streak-at-risk is included but left UNscheduled.)
-- ════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── Helper: POST to the send-push function for a set of users ───────────────
create or replace function public.send_push(target uuid[], payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fn_url text;
  svc    text;
begin
  if array_length(target, 1) is null then
    return;
  end if;

  select decrypted_secret into fn_url
  from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into svc
  from vault.decrypted_secrets where name = 'service_role_key';

  perform net.http_post(
    url     := fn_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || svc
    ),
    body    := jsonb_build_object('user_ids', to_jsonb(target), 'payload', payload),
    timeout_milliseconds := 5000
  );
end;
$$;

-- ── Reminders: who is due in the current 15-minute window (their local tz) ──
create or replace function public.cron_send_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
begin
  select array_agg(distinct r.user_id) into ids
  from reminders r
  join profiles p on p.id = r.user_id
  where r.enabled
    and extract(dow from (now() at time zone p.timezone))::int = any (r.days)
    and (now() at time zone p.timezone)::time >= r.time
    and (now() at time zone p.timezone)::time < (r.time + interval '15 minutes');

  perform public.send_push(
    ids,
    jsonb_build_object(
      'title', 'Iqra',
      'body',  'Time to log your Quran today.',
      'url',   '/today',
      'tag',   'reminder'
    )
  );
end;
$$;

-- ── Streak-at-risk (OPTIONAL): nothing logged today by ~21:00 local ─────────
-- Left defined but UNscheduled per the "reminders only" policy. Schedule it
-- (bottom of file) if you decide you want it.
create or replace function public.cron_streak_at_risk()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
begin
  select array_agg(p.id) into ids
  from profiles p
  where (now() at time zone p.timezone)::time >= time '21:00'
    and (now() at time zone p.timezone)::time <  time '21:15'
    and not exists (
      select 1 from log_entries le
      where le.user_id = p.id
        and (le.logged_at at time zone p.timezone)::date
            = (now() at time zone p.timezone)::date
    );

  perform public.send_push(
    ids,
    jsonb_build_object(
      'title', 'Keep your streak',
      'body',  'You haven''t logged today yet.',
      'url',   '/today',
      'tag',   'streak'
    )
  );
end;
$$;

-- ── @mention → push (trigger on new messages) ──────────────────────────────
create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  targets uuid[];
  sender  text;
begin
  targets := array_remove(new.mentions, new.user_id); -- never notify yourself
  if array_length(targets, 1) is null then
    return new;
  end if;

  select coalesce(display_name, 'Someone') into sender
  from profiles where id = new.user_id;

  perform public.send_push(
    targets,
    jsonb_build_object(
      'title', sender || ' mentioned you',
      'body',  left(new.body, 120),
      'url',   '/chat',
      'tag',   'mention'
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_message_mention on public.messages;
create trigger trg_message_mention
  after insert on public.messages
  for each row execute function public.on_message_insert();

-- ── Schedule the reminder sweep every 15 minutes ───────────────────────────
-- (Re-running is safe: unschedule first if it already exists.)
select cron.unschedule('iqra-reminders')
  where exists (select 1 from cron.job where jobname = 'iqra-reminders');
select cron.schedule('iqra-reminders', '*/15 * * * *', $$select public.cron_send_reminders();$$);

-- To enable streak-at-risk, uncomment:
-- select cron.schedule('iqra-streak', '*/15 * * * *', $$select public.cron_streak_at_risk();$$);
