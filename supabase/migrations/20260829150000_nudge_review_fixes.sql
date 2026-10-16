-- ════════════════════════════════════════════════════════════════════════
-- Fixes from the adversarial review of the personal-notification build.
-- Each was reproduced by execution before being fixed here:
--
--  1. Reminder window arithmetic wrapped at midnight (`time + interval`
--     wraps mod 24h), so a 23:45–23:59 reminder could NEVER fire — silent,
--     pre-existing since the original cron. Now a wrap-safe minute diff.
--  2. The rewrite iterated reminder ROWS where the original aggregated
--     distinct users — duplicate rows would double-push. DISTINCT ON user.
--  3. The lapse nudge's Sunday stand-down permanently starved anyone whose
--     LAST log was a Sunday: past 30 days, every eligible weekly day
--     (days_silent % 7 = 0) is itself a Sunday. The stand-down now applies
--     only to the daily phase; the weekly phase may land on Sundays (a
--     >30-day-silent member getting both recap and nudge that evening is
--     the intended outcome, not spam).
--  4. A week of ayah-only entries read as "nothing logged" in the recap
--     (pages_equiv is NULL for ayah rows by design). The recap now honours
--     showing up: pages branch, then active-days branch, then quiet week.
--
-- Known, accepted: reminders set 01:00–02:59 local can double-fire on the
-- fall-back night and skip on the spring-forward night (two/zero cron ticks
-- map to that local window). Fixing it needs a sent-log; no member has a
-- night-hours reminder, and the failure is two same-text pushes once a year
-- at worst. Revisit if anyone sets one.
-- ════════════════════════════════════════════════════════════════════════

-- Wrap-safe "is local time within [t, t+15min)" — seconds since t, mod 24h.
create or replace function public.in_quarter_window(local_now time, t time)
returns boolean
language sql
immutable
as $$
  select mod(extract(epoch from (local_now - t))::int + 86400, 86400) < 900;
$$;

create or replace function public.cron_send_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  snap record;
  line text;
  seed text;
  morning boolean;
  tips text[] := array[
    'Tip: tie your reading to a salah you never miss — right after it is the easiest slot to keep.',
    'Tip: leave your mushaf somewhere you can see it, not in a drawer.',
    'Tip: five ayahs after every salah quietly adds up to a khatmah a year.',
    'Tip: read along while a reciter plays — it carries you further than pushing through alone.',
    'Tip: on a heavy day, one ayah with attention beats a page without it.'
  ];
begin
  for r in
    -- One send per user per tick, however many reminder rows match.
    select distinct on (p.id) p.id, p.timezone, rem.time as remind_at
    from reminders rem
    join profiles p on p.id = rem.user_id
    where rem.enabled
      and extract(dow from (now() at time zone p.timezone))::int = any (rem.days)
      and public.in_quarter_window((now() at time zone p.timezone)::time, rem.time)
    order by p.id, rem.time
  loop
    select * into snap from public.reading_snapshot(r.id, r.timezone);

    -- Already logged today: the reminder has nothing to remind. Stay quiet.
    continue when snap.logged_today;

    seed := r.id::text || (now() at time zone r.timezone)::date::text;
    morning := r.remind_at < time '12:00';

    if snap.streak >= 2 then
      line := format(
        public.pick_line(array[
          '%s days in a row. Today makes %s.',
          'Your %s-day run is one page from continuing. (Day %s is this one.)',
          '%s straight days so far — don''t let today be the gap. %s in a row is right there.'
        ], seed),
        snap.streak, snap.streak + 1);
    elsif snap.bookmark_page is not null then
      line := format(
        public.pick_line(case when morning then array[
          'Page %1$s is bookmarked — start the day with a little %2$s.',
          'You left off in %2$s. A page with your morning tea?',
          '%2$s is waiting at page %1$s.'
        ] else array[
          'Page %1$s is bookmarked — a little %2$s before sleep?',
          'You left off in %2$s. Pick it back up for one page.',
          '%2$s is waiting at page %1$s.'
        ] end, seed),
        snap.bookmark_page, snap.surah);
    else
      line := public.pick_line(case when morning then array[
        'Start the day with a page — it changes the shape of the whole day.',
        'A few verses with your morning coffee still count.',
        'One page now, before the day gets loud.'
      ] else array[
        'A few verses before bed still count.',
        'Half a page tonight beats a blank day.',
        'Close the day with a little Quran.'
      ] end, seed);
    end if;

    if mod(abs(hashtext(seed || 'tip')::bigint), 3) = 0 then
      line := line || ' ' || public.pick_line(tips, seed || 'tipline');
    end if;

    perform public.send_push(
      array[r.id],
      jsonb_build_object('title', 'Iqra', 'body', line, 'url', '/today', 'tag', 'reminder')
    );
  end loop;
end;
$$;

create or replace function public.cron_lapsed_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  seed text;
  tail text;
begin
  for r in
    with lapse as (
      select
        p.id,
        p.timezone,
        (now() at time zone p.timezone)::date as local_today,
        extract(dow from (now() at time zone p.timezone))::int as local_dow,
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
          ((l.local_today + time '19:30')::timestamp at time zone l.timezone)
        ) as sunset_at
      from lapse l
      left join tz_sun_coords c on c.tz = l.timezone
      where l.last_day < l.local_today
        and (
          -- Daily phase: first 30 silent days, standing down on Sundays
          -- (the recap carries that evening's touch instead).
          ((l.local_today - l.last_day) <= 30 and l.local_dow <> 0)
          -- Weekly phase: multiples of 7, ON ANY weekday — for a member
          -- whose last log was a Sunday these all land on Sundays, and a
          -- blanket stand-down would silence them forever.
          or ((l.local_today - l.last_day) > 30
              and (l.local_today - l.last_day) % 7 = 0)
        )
    )
    select id, days_silent
    from due
    where now() >= sunset_at
      and now() <  sunset_at + interval '15 minutes'
  loop
    seed := r.id::text || current_date::text;
    tail := public.pick_line(array[
      'The page you stopped on hasn''t moved.',
      'One small entry restarts everything.',
      'Tonight is an easy place to begin again.',
      'Even half a page counts as a return.'
    ], seed);
    perform public.send_push(
      array[r.id],
      jsonb_build_object(
        'title', 'Iqra',
        'body',
          case
            when r.days_silent = 1
              then 'The sun has set and today''s page is still open. ' || tail
            else format('You haven''t logged in %s days. ', r.days_silent) || tail
          end,
        'url', '/today',
        'tag', 'lapsed'
      )
    );
  end loop;
end;
$$;

create or replace function public.cron_weekly_recap()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    with wk as (
      select
        p.id,
        (now() at time zone p.timezone)::date as local_today,
        ((now() at time zone p.timezone)::date
          - ((extract(dow from (now() at time zone p.timezone))::int + 6) % 7)) as monday
      from profiles p
      where extract(dow from (now() at time zone p.timezone))::int = 0
        and (now() at time zone p.timezone)::time >= time '20:00'
        and (now() at time zone p.timezone)::time <  time '20:15'
    )
    select
      wk.id,
      coalesce(sum(le.pages_equiv), 0)::numeric(8,1) as pages,
      count(distinct (le.logged_at at time zone p.timezone)::date) as active_days
    from wk
    join profiles p on p.id = wk.id
    left join log_entries le
      on le.user_id = wk.id
     and (le.logged_at at time zone p.timezone)::date between wk.monday and wk.local_today
    group by wk.id, p.timezone
  loop
    perform public.send_push(
      array[r.id],
      jsonb_build_object(
        'title', 'Your week in review',
        'body',
          case
            when r.pages > 0 then format(
              'Your week: %s page%s across %s day%s. Tap to see your recap.',
              case when r.pages = trunc(r.pages) then trunc(r.pages)::text else r.pages::text end,
              case when r.pages = 1 then '' else 's' end,
              r.active_days,
              case when r.active_days = 1 then '' else 's' end)
            -- Ayah-only entries carry no page count (pages_equiv is NULL by
            -- design) — but showing up is showing up. Never call it quiet.
            when r.active_days > 0 then format(
              'You showed up %s day%s this week. Tap to see your recap.',
              r.active_days,
              case when r.active_days = 1 then '' else 's' end)
            else 'A quiet week — nothing logged. Next week opens tomorrow; tap to see where you left off.'
          end,
        'url', '/stats#recap',
        'tag', 'recap'
      )
    );
  end loop;
end;
$$;
