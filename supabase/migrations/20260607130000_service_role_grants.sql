-- ════════════════════════════════════════════════════════════════════════
-- Iqra — grant table privileges to service_role
-- service_role bypasses RLS but still needs base table GRANTs. The edge
-- function (send-push) connects as service_role to read push_subscriptions and
-- prune dead ones, so without these grants it silently finds nothing to send.
-- ════════════════════════════════════════════════════════════════════════

grant usage on schema public to service_role;

grant select, insert, update, delete on
  public.profiles,
  public.groups,
  public.group_members,
  public.log_entries,
  public.messages,
  public.nudges,
  public.push_subscriptions,
  public.reminders
to service_role;
