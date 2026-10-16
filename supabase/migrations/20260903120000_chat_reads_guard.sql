-- Hardening from the adversarial review of read receipts. Three verified
-- holes, all closed server-side where clients can't argue:
--
--  1. REWIND: a stale tab could upsert an older frontier over a newer one
--     written by the phone (client latches are per-device). Frontiers are
--     now monotonic at the row: an UPDATE keeps greatest(old, new).
--  2. SPOOF: last_read_at had no bound - a hacked client could write year
--     3000 (or 'infinity') and pin its avatar under the newest message
--     forever. Clamped to now() + 5 minutes of clock skew.
--  3. RE-POINT: the update policy checked only ownership, so a row could be
--     UPDATEd into a group the user never joined (unfiltered PATCH), and an
--     ex-member could keep stamping the circle that removed them. The
--     trigger pins group_id/user_id immutably, and the policy now also
--     requires current membership.
create or replace function public.chat_reads_guard()
returns trigger
language plpgsql
as $$
begin
  new.last_read_at := least(new.last_read_at, now() + interval '5 minutes');
  if tg_op = 'UPDATE' then
    new.last_read_at := greatest(new.last_read_at, old.last_read_at);
    -- A frontier row never changes owner or circle.
    new.group_id := old.group_id;
    new.user_id  := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_chat_reads_guard on public.chat_reads;
create trigger trg_chat_reads_guard
  before insert or update on public.chat_reads
  for each row execute function public.chat_reads_guard();

drop policy if exists chat_reads_update on public.chat_reads;
create policy chat_reads_update on public.chat_reads
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = chat_reads.group_id and gm.user_id = auth.uid()
    )
  )
  with check (user_id = auth.uid());
