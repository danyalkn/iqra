-- ════════════════════════════════════════════════════════════════════════
-- Iqra — nudge → push (run AFTER 20260606120500_push.sql; needs send_push)
-- A nudge is a deliberate, rate-limited (~1/recipient/day, enforced in-app)
-- poke, so it does notify the recipient.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.on_nudge_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender text;
begin
  select coalesce(display_name, 'Someone') into sender
  from profiles where id = new.from_user;

  perform public.send_push(
    array[new.to_user],
    jsonb_build_object(
      'title', sender || ' nudged you',
      'body',  'Log your Quran for today.',
      'url',   '/today',
      'tag',   'nudge'
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_nudge_push on public.nudges;
create trigger trg_nudge_push
  after insert on public.nudges
  for each row execute function public.on_nudge_insert();
