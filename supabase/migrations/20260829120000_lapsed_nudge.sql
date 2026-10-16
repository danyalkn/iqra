-- ════════════════════════════════════════════════════════════════════════
-- Iqra — sunset lapse nudge
--
-- POLICY CHANGE (builder direction, 2026-07-30): the original "reminders and
-- @mentions only" notification policy now also includes a self-inactivity
-- nudge. Every day a member has not logged, they get one push at LOCAL SUNSET:
--   "You haven't logged in X days."
-- Sunset (≈ Maghrib) rather than a fixed hour: the day is visibly closing,
-- and there is still time to read before it does. This supersedes the
-- never-scheduled cron_streak_at_risk() (21:00 fixed), which stays unscheduled.
--
-- Mechanics mirror cron_send_reminders: a */15 pg_cron sweep, each user
-- matching when now() falls in [their sunset, sunset + 15 min) — exactly one
-- tick per day. Sends go through public.send_push (Vault-authed edge call).
--
-- Guard rails:
--   • skip anyone who has logged TODAY (their local date);
--   • skip anyone who has never logged (no baseline to count from);
--   • daily for the first 30 silent days, then WEEKLY (multiples of 7) —
--     a long-lapsed member still gets a touch, but daily pings at an
--     abandoned account are noise, not encouragement. (A hard cutoff was
--     rejected: it would have permanently excluded anyone already past it
--     on launch day — the most lapsed member is exactly the one to reach.)
--   • users without push subscriptions cost nothing (send-push finds 0 rows).
-- ════════════════════════════════════════════════════════════════════════

-- ── Representative coordinates per IANA timezone ────────────────────────────
-- Sunset needs a location; profiles only carry a timezone. A principal-city
-- approximation is within ~15 min of true local sunset across almost all of a
-- zone — the same width as the cron window. Unknown zones fall back to a
-- fixed 19:30 local in cron_lapsed_nudges().
create table if not exists public.tz_sun_coords (
  tz  text primary key,
  lat double precision not null,
  lng double precision not null
);

insert into public.tz_sun_coords (tz, lat, lng) values
  ('America/Toronto',     43.65,  -79.38),
  ('America/New_York',    40.71,  -74.01),
  ('America/Chicago',     41.88,  -87.63),
  ('America/Denver',      39.74, -104.99),
  ('America/Los_Angeles', 34.05, -118.24),
  ('America/Vancouver',   49.28, -123.12),
  ('America/Edmonton',    53.55, -113.49),
  ('Europe/London',       51.51,   -0.13),
  ('Europe/Paris',        48.86,    2.35),
  ('Europe/Istanbul',     41.01,   28.98),
  ('Africa/Cairo',        30.04,   31.24),
  ('Asia/Riyadh',         24.71,   46.68),
  ('Asia/Dubai',          25.20,   55.27),
  ('Asia/Karachi',        24.86,   67.00),
  ('Asia/Kolkata',        22.57,   88.36),
  ('Asia/Dhaka',          23.81,   90.41),
  ('Asia/Kuala_Lumpur',    3.14,  101.69),
  ('Asia/Jakarta',        -6.21,  106.85),
  ('Asia/Singapore',       1.35,  103.82)
on conflict (tz) do nothing;

-- Server-side only — nothing user-facing reads this table.
alter table public.tz_sun_coords enable row level security;

-- ── Sunset for a local calendar date at given coordinates (UTC instant) ─────
-- NOAA simplified: fractional-year Fourier fits for the equation of time and
-- solar declination, zenith 90.833° (refraction + solar radius). Verified
-- against published Toronto sunsets to within 4 minutes across the year.
-- Returns null in polar day/night — callers fall back to a fixed local time.
create or replace function public.sunset_utc(on_date date, lat double precision, lng double precision)
returns timestamptz
language plpgsql
immutable
as $$
declare
  g      double precision := 2 * pi() / 365.0 * (extract(doy from on_date) - 1);
  eot    double precision;
  decl   double precision;
  cos_ha double precision;
  ha     double precision;
  mins   double precision;
begin
  eot := 229.18 * (0.000075 + 0.001868 * cos(g) - 0.032077 * sin(g)
                 - 0.014615 * cos(2 * g) - 0.040849 * sin(2 * g));
  decl := 0.006918 - 0.399912 * cos(g) + 0.070257 * sin(g)
        - 0.006758 * cos(2 * g) + 0.000907 * sin(2 * g)
        - 0.002697 * cos(3 * g) + 0.00148 * sin(3 * g);
  cos_ha := cos(radians(90.833)) / (cos(radians(lat)) * cos(decl))
          - tan(radians(lat)) * tan(decl);
  if cos_ha < -1 or cos_ha > 1 then
    return null; -- polar day or night: no sunset today at this latitude
  end if;
  ha   := degrees(acos(cos_ha));
  mins := 720 - 4 * (lng - ha) - eot;
  return (on_date::timestamp at time zone 'UTC') + make_interval(mins => mins::int);
end;
$$;

-- ── The sweep: who is at sunset with an unlogged day ────────────────────────
create or replace function public.cron_lapsed_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    with lapse as (
      select
        p.id,
        p.timezone,
        (now() at time zone p.timezone)::date as local_today,
        max((le.logged_at at time zone p.timezone)::date) as last_day
      from profiles p
      join log_entries le on le.user_id = p.id
      group by p.id, p.timezone
    ),
    due as (
      select
        l.id,
        (l.local_today - l.last_day) as days_silent,
        coalesce(
          sunset_utc(l.local_today, c.lat, c.lng),
          -- Unknown zone or polar edge: 19:30 local stands in for sunset.
          ((l.local_today + time '19:30')::timestamp at time zone l.timezone)
        ) as sunset_at
      from lapse l
      left join tz_sun_coords c on c.tz = l.timezone
      where l.last_day < l.local_today            -- nothing logged today
        and ((l.local_today - l.last_day) <= 30   -- daily for the first month…
             or (l.local_today - l.last_day) % 7 = 0)  -- …then weekly
    )
    select id, days_silent
    from due
    where now() >= sunset_at
      and now() <  sunset_at + interval '15 minutes'
  loop
    perform public.send_push(
      array[r.id],
      jsonb_build_object(
        'title', 'Iqra',
        'body',
          case
            when r.days_silent = 1
              then 'The sun has set and today''s page is still open. You haven''t logged since yesterday.'
            else format('You haven''t logged in %s days. A few verses before bed still count.', r.days_silent)
          end,
        'url', '/today',
        'tag', 'lapsed'
      )
    );
  end loop;
end;
$$;

-- ── Schedule the sweep every 15 minutes ─────────────────────────────────────
-- (Re-running is safe: unschedule first if it already exists.)
select cron.unschedule('iqra-lapsed')
  where exists (select 1 from cron.job where jobname = 'iqra-lapsed');
select cron.schedule('iqra-lapsed', '*/15 * * * *', $$select public.cron_lapsed_nudges();$$);
