-- ════════════════════════════════════════════════════════════════════════
-- Iqra — personal reminders, Sunday recap, varied lapse nudges
--
-- Owner direction (2026-08-29):
--   • Reminders stop being the same static sentence every day. Each one is
--     built from the member's own state — active streak, bookmarked page and
--     its surah, morning vs evening reminder time — with rotating phrasing
--     and practical advice mixed in every few days.
--   • A reminder is SKIPPED when the member already logged today. Its job is
--     done; pinging anyway teaches people to ignore it.
--   • Sunday evening: a personal week-in-review push ("Your week: N pages
--     across D days") that deep-links to the recap card on the Insights page
--     (/stats#recap). Personal only — no member-vs-member comparisons.
--   • The sunset lapse nudge keeps its contract sentence ("You haven't
--     logged in X days.") but rotates its follow-up line, and stands down on
--     Sundays — the recap already carries that evening's touch.
-- ════════════════════════════════════════════════════════════════════════

-- ── Surah lookup: which surah a Madani page falls in ────────────────────────
-- Mirror of SURAHS in src/lib/mushaf.ts (generated from it — do not hand-edit)
-- so server-side copy can say "page 213 — Surah Yusuf".
create table if not exists public.surah_starts (
  number int primary key,
  name   text not null,
  page   int  not null
);

insert into public.surah_starts (number, name, page) values
  (1, 'Al-Fatihah', 1),
  (2, 'Al-Baqarah', 2),
  (3, 'Ali ''Imran', 50),
  (4, 'An-Nisa', 77),
  (5, 'Al-Ma''idah', 106),
  (6, 'Al-An''am', 128),
  (7, 'Al-A''raf', 151),
  (8, 'Al-Anfal', 177),
  (9, 'At-Tawbah', 187),
  (10, 'Yunus', 208),
  (11, 'Hud', 221),
  (12, 'Yusuf', 235),
  (13, 'Ar-Ra''d', 249),
  (14, 'Ibrahim', 255),
  (15, 'Al-Hijr', 262),
  (16, 'An-Nahl', 267),
  (17, 'Al-Isra', 282),
  (18, 'Al-Kahf', 293),
  (19, 'Maryam', 305),
  (20, 'Taha', 312),
  (21, 'Al-Anbya', 322),
  (22, 'Al-Hajj', 332),
  (23, 'Al-Mu''minun', 342),
  (24, 'An-Nur', 350),
  (25, 'Al-Furqan', 359),
  (26, 'Ash-Shu''ara', 367),
  (27, 'An-Naml', 377),
  (28, 'Al-Qasas', 385),
  (29, 'Al-''Ankabut', 396),
  (30, 'Ar-Rum', 404),
  (31, 'Luqman', 411),
  (32, 'As-Sajdah', 415),
  (33, 'Al-Ahzab', 418),
  (34, 'Saba', 428),
  (35, 'Fatir', 434),
  (36, 'Ya-Sin', 440),
  (37, 'As-Saffat', 446),
  (38, 'Sad', 453),
  (39, 'Az-Zumar', 458),
  (40, 'Ghafir', 467),
  (41, 'Fussilat', 477),
  (42, 'Ash-Shuraa', 483),
  (43, 'Az-Zukhruf', 489),
  (44, 'Ad-Dukhan', 496),
  (45, 'Al-Jathiyah', 499),
  (46, 'Al-Ahqaf', 502),
  (47, 'Muhammad', 507),
  (48, 'Al-Fath', 511),
  (49, 'Al-Hujurat', 515),
  (50, 'Qaf', 518),
  (51, 'Adh-Dhariyat', 520),
  (52, 'At-Tur', 523),
  (53, 'An-Najm', 526),
  (54, 'Al-Qamar', 528),
  (55, 'Ar-Rahman', 531),
  (56, 'Al-Waqi''ah', 534),
  (57, 'Al-Hadid', 537),
  (58, 'Al-Mujadila', 542),
  (59, 'Al-Hashr', 545),
  (60, 'Al-Mumtahanah', 549),
  (61, 'As-Saf', 551),
  (62, 'Al-Jumu''ah', 553),
  (63, 'Al-Munafiqun', 554),
  (64, 'At-Taghabun', 556),
  (65, 'At-Talaq', 558),
  (66, 'At-Tahrim', 560),
  (67, 'Al-Mulk', 562),
  (68, 'Al-Qalam', 564),
  (69, 'Al-Haqqah', 566),
  (70, 'Al-Ma''arij', 568),
  (71, 'Nuh', 570),
  (72, 'Al-Jinn', 572),
  (73, 'Al-Muzzammil', 574),
  (74, 'Al-Muddaththir', 575),
  (75, 'Al-Qiyamah', 577),
  (76, 'Al-Insan', 578),
  (77, 'Al-Mursalat', 580),
  (78, 'An-Naba', 582),
  (79, 'An-Nazi''at', 583),
  (80, '''Abasa', 585),
  (81, 'At-Takwir', 586),
  (82, 'Al-Infitar', 587),
  (83, 'Al-Mutaffifin', 587),
  (84, 'Al-Inshiqaq', 589),
  (85, 'Al-Buruj', 590),
  (86, 'At-Tariq', 591),
  (87, 'Al-A''la', 591),
  (88, 'Al-Ghashiyah', 592),
  (89, 'Al-Fajr', 593),
  (90, 'Al-Balad', 594),
  (91, 'Ash-Shams', 595),
  (92, 'Al-Layl', 595),
  (93, 'Ad-Duhaa', 596),
  (94, 'Ash-Sharh', 596),
  (95, 'At-Tin', 597),
  (96, 'Al-''Alaq', 597),
  (97, 'Al-Qadr', 598),
  (98, 'Al-Bayyinah', 598),
  (99, 'Az-Zalzalah', 599),
  (100, 'Al-''Adiyat', 599),
  (101, 'Al-Qari''ah', 600),
  (102, 'At-Takathur', 600),
  (103, 'Al-''Asr', 601),
  (104, 'Al-Humazah', 601),
  (105, 'Al-Fil', 601),
  (106, 'Quraysh', 602),
  (107, 'Al-Ma''un', 602),
  (108, 'Al-Kawthar', 602),
  (109, 'Al-Kafirun', 603),
  (110, 'An-Nasr', 603),
  (111, 'Al-Masad', 603),
  (112, 'Al-Ikhlas', 604),
  (113, 'Al-Falaq', 604),
  (114, 'An-Nas', 604)
on conflict (number) do nothing;

alter table public.surah_starts enable row level security;

create or replace function public.surah_name_for_page(p int)
returns text
language sql
stable
as $$
  select name from public.surah_starts
  where page <= p
  order by page desc
  limit 1;
$$;

-- ── Deterministic daily variety ─────────────────────────────────────────────
-- Same member, same day → same line (idempotent across retries); different
-- members and different days → different lines.
create or replace function public.pick_line(pool text[], seed text)
returns text
language sql
immutable
as $$
  select pool[1 + mod(abs(hashtext(seed)::bigint), array_length(pool, 1)::bigint)::int];
$$;

-- ── A member's reading state, as the copy needs it ──────────────────────────
create or replace function public.reading_snapshot(uid uuid, tz text)
returns table (
  logged_today  boolean,
  streak        int,        -- consecutive logged days ending YESTERDAY
  bookmark_page int,        -- latest reading/revising bookmark, null if none
  surah         text
)
language plpgsql
stable
as $$
declare
  local_today date := (now() at time zone tz)::date;
  k int := 0;
  ref text;
begin
  logged_today := exists (
    select 1 from log_entries le
    where le.user_id = uid
      and (le.logged_at at time zone tz)::date = local_today
  );

  -- Streak ending yesterday: the reminder fires when today is still open,
  -- so "don't break the chain" counts the days already banked.
  while exists (
    select 1 from log_entries le
    where le.user_id = uid
      and (le.logged_at at time zone tz)::date = local_today - 1 - k
  ) loop
    k := k + 1;
  end loop;
  streak := k;

  select le.to_ref into ref
  from log_entries le
  where le.user_id = uid
    and le.entry_type in ('reading', 'revising')
    and le.to_ref is not null
  order by le.logged_at desc
  limit 1;
  bookmark_page := nullif(substring(coalesce(ref, '') from '\d+'), '')::int;
  surah := case when bookmark_page is null then null
               else public.surah_name_for_page(bookmark_page) end;
  return next;
end;
$$;

-- ── Reminders, rewritten: personal, varied, and quiet once the job is done ──
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
    select p.id, p.timezone, rem.time as remind_at
    from reminders rem
    join profiles p on p.id = rem.user_id
    where rem.enabled
      and extract(dow from (now() at time zone p.timezone))::int = any (rem.days)
      and (now() at time zone p.timezone)::time >= rem.time
      and (now() at time zone p.timezone)::time < (rem.time + interval '15 minutes')
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

    -- Practical advice every third day, rotating through the pool.
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

-- ── Lapse nudge: contract sentence + rotating tail; Sundays yield to recap ──
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
        max((le.logged_at at time zone p.timezone)::date) as last_day
      from profiles p
      join log_entries le on le.user_id = p.id
      where extract(dow from (now() at time zone p.timezone))::int <> 0
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
        and ((l.local_today - l.last_day) <= 30
             or (l.local_today - l.last_day) % 7 = 0)
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

-- ── Sunday recap: personal week-in-review, tap → /stats#recap ───────────────
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
            else 'A quiet week — nothing logged. Next week opens tomorrow; tap to see where you left off.'
          end,
        'url', '/stats#recap',
        'tag', 'recap'
      )
    );
  end loop;
end;
$$;

-- ── Schedule ────────────────────────────────────────────────────────────────
select cron.unschedule('iqra-recap')
  where exists (select 1 from cron.job where jobname = 'iqra-recap');
select cron.schedule('iqra-recap', '*/15 * * * *', $$select public.cron_weekly_recap();$$);
