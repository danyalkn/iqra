-- House style (owner direction, 2026-08-29): no em dashes in any copy a
-- member reads. Redefines the two cron functions whose notification strings
-- carried them; the lapse-nudge strings were already clean. Wording otherwise
-- identical to 20260829150000.
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
    'Tip: tie your reading to a salah you never miss. Right after it is the easiest slot to keep.',
    'Tip: leave your mushaf somewhere you can see it, not in a drawer.',
    'Tip: five ayahs after every salah quietly adds up to a khatmah a year.',
    'Tip: read along while a reciter plays. It carries you further than pushing through alone.',
    'Tip: on a heavy day, one ayah with attention beats a page without it.'
  ];
begin
  for r in
    select distinct on (p.id) p.id, p.timezone, rem.time as remind_at
    from reminders rem
    join profiles p on p.id = rem.user_id
    where rem.enabled
      and extract(dow from (now() at time zone p.timezone))::int = any (rem.days)
      and public.in_quarter_window((now() at time zone p.timezone)::time, rem.time)
    order by p.id, rem.time
  loop
    select * into snap from public.reading_snapshot(r.id, r.timezone);
    continue when snap.logged_today;

    seed := r.id::text || (now() at time zone r.timezone)::date::text;
    morning := r.remind_at < time '12:00';

    if snap.streak >= 2 then
      line := format(
        public.pick_line(array[
          '%s days in a row. Today makes %s.',
          'Your %s-day run is one page from continuing. (Day %s is this one.)',
          '%s straight days so far. Don''t let today be the gap; %s in a row is right there.'
        ], seed),
        snap.streak, snap.streak + 1);
    elsif snap.bookmark_page is not null then
      line := format(
        public.pick_line(case when morning then array[
          'Page %1$s is bookmarked. Start the day with a little %2$s.',
          'You left off in %2$s. A page with your morning tea?',
          '%2$s is waiting at page %1$s.'
        ] else array[
          'Page %1$s is bookmarked. A little %2$s before sleep?',
          'You left off in %2$s. Pick it back up for one page.',
          '%2$s is waiting at page %1$s.'
        ] end, seed),
        snap.bookmark_page, snap.surah);
    else
      line := public.pick_line(case when morning then array[
        'Start the day with a page. It changes the shape of the whole day.',
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
            when r.active_days > 0 then format(
              'You showed up %s day%s this week. Tap to see your recap.',
              r.active_days,
              case when r.active_days = 1 then '' else 's' end)
            else 'A quiet week, nothing logged. Next week opens tomorrow; tap to see where you left off.'
          end,
        'url', '/stats#recap',
        'tag', 'recap'
      )
    );
  end loop;
end;
$$;
