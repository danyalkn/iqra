-- ════════════════════════════════════════════════════════════════════════
-- Iqra — @mention support on chat messages
-- Stores the user_ids tagged in a message so the push webhook (later) can
-- notify exactly those people. (Pushes fire for @mentions + reminders only.)
-- ════════════════════════════════════════════════════════════════════════

alter table public.messages
  add column if not exists mentions uuid[] not null default '{}';
