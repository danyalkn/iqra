-- The two server-side lookup tables (sunset coords, surah starts) are read by
-- plain (non-definer) helper functions. pg_cron invokes those through
-- SECURITY DEFINER functions owned by postgres, so the crons work either way —
-- but service-role verification calls hit bare-table permissions (the classic
-- "RLS alone isn't enough" setup gotcha). Server roles only; clients have the
-- same data in the bundle already.
grant select on public.tz_sun_coords  to service_role;
grant select on public.surah_starts   to service_role;
