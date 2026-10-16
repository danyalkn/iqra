-- ════════════════════════════════════════════════════════════════════════
-- Iqra — structured hifz logging
-- Memorizers pick the Juz (1–30) and a portion via scroll wheels, so the same
-- thing is always recorded identically (enables real trends — "which juz /
-- quarter do I revise most"). `unit` carries the granularity:
--   juz   = full juz   (20 pages, part = null)
--   hizb  = half juz   (10 pages, part = 1–2  → which half)
--   quarter = quarter  ( 5 pages, part = 1–4  → which quarter)
-- ════════════════════════════════════════════════════════════════════════

alter table public.log_entries
  add column if not exists juz smallint check (juz between 1 and 30);

alter table public.log_entries
  add column if not exists part smallint check (part between 1 and 4);

-- Helps "by juz" trend queries.
create index if not exists log_entries_juz_idx
  on public.log_entries (user_id, juz);
