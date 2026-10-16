-- ════════════════════════════════════════════════════════════════════════
-- Iqra — per-user mushaf (15-line Uthmani vs 13-line Indo-Pak)
-- The bookmark (page → juz/surah) is mushaf-specific, so each reading entry is
-- stamped with the mushaf it was logged in (renders correctly for everyone in
-- the feed). Quantity stays 1:1 — a page is a page. Both columns default to the
-- existing 15-line Uthmani, so current users and data are unaffected.
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists mushaf text not null default 'uthmani15'
    check (mushaf in ('uthmani15', 'indopak13'));

alter table public.log_entries
  add column if not exists mushaf text not null default 'uthmani15'
    check (mushaf in ('uthmani15', 'indopak13'));
