-- ════════════════════════════════════════════════════════════════════════
-- Iqra - Phase 3 push (docs/PHASE3.md "Phase 3 migration")
--
-- Three things, nothing the web PWA reads changes:
--
--   1. send_push(uuid[], jsonb) was never revoked from clients, so any
--      signed-in member could call it over PostgREST's /rpc and push to the
--      whole circle. Only the cron jobs and triggers (owner-run, security
--      definer) may call it.
--
--   2. Reminder pushes gain a `category` key so the native app can show log
--      buttons under them (expo-notifications categories logReading and
--      logHifz; the identifiers avoid ":" and "-" as the SDK docs require).
--      A typed reminder follows its entry type (a hifz member's "Reading"
--      reminder gets the reading buttons); an untyped one follows the
--      member's mode. Chat, nudge and recap pushes get no category. The
--      streak-grace nudge gets none either: it asks the member to log
--      YESTERDAY, and a one-tap action logs now, so it opens the app where
--      the Yesterday control is.
--
-- The four functions below are the latest definitions from
-- 20260906120000_day_reminders.sql (day reminders),
-- 20260829160000_no_em_dashes.sql (daily reminders) and
-- 20260829150000_nudge_review_fixes.sql (lapsed nudge), with only the
-- `category` line and the mode lookup added. No em dashes in any copy.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. send_push is server-only ─────────────────────────────────────────────
revoke execute on function public.send_push(uuid[], jsonb) from public, anon, authenticated;

-- ── 2a. Category for a reminder ─────────────────────────────────────────────
create or replace function public.push_category(p_mode text, p_entry_type text)
returns text
language sql
immutable
as $$
  select case
    when p_entry_type in ('sabak', 'sabak_para', 'dor') then 'logHifz'
    when p_entry_type in ('reading', 'revising')        then 'logReading'
    when p_mode = 'hifz'                                then 'logHifz'
    else 'logReading'
  end
$$;

revoke execute on function public.push_category(text, text) from public, anon, authenticated;

-- ── 2b. One-time day reminders ──────────────────────────────────────────────
create or replace function public.cron_send_day_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  label text;
  body  text;
  mode  text;
begin
  -- A week of history is plenty; Today only ever shows today and tomorrow.
  delete from day_reminders where remind_on < current_date - 7;

  -- 1. Quiet once the job is done: the reminder is FOR a type that was
  --    logged after it was set. Marked rather than deleted so Today can say
  --    "Logged" instead of the row silently vanishing.
  update day_reminders d
  set skipped_at = now()
  from profiles p
  where p.id = d.user_id
    and d.sent_at is null
    and d.skipped_at is null
    and d.due_at <= now()
    and d.entry_type is not null
    and exists (
      select 1 from log_entries le
      where le.user_id = d.user_id
        and le.entry_type = d.entry_type
        and le.logged_at > d.created_at
        -- ...and on the reminder's own day: a Sabak logged tonight must not
        -- silence tomorrow morning's Sabak reminder.
        and (le.logged_at at time zone p.timezone)::date = d.remind_on
    );

  -- 2. Claim and send in one statement. "Due" is simply that the instant has
  --    passed; "expired" that its local day is over (both frozen at insert).
  for r in
    update day_reminders d
    set sent_at = now()
    where d.sent_at is null
      and d.skipped_at is null
      and d.due_at <= now()
      and now() < d.expires_at
    returning d.id, d.user_id, d.entry_type, d.note
  loop
    -- Mirror of ENTRY_META labels in src/lib/entries.ts.
    label := case r.entry_type
      when 'sabak'      then 'Sabak'
      when 'sabak_para' then 'Sabak Para'
      when 'dor'        then 'Dhor'
      when 'reading'    then 'Reading'
      when 'revising'   then 'Revising'
    end;

    -- The member's own words first; otherwise a short nudge in house voice.
    body := coalesce(
      nullif(btrim(r.note), ''),
      case
        when r.entry_type is null       then 'Time for a little Quran.'
        when r.entry_type = 'reading'   then 'Time to read. Tap to log it.'
        when r.entry_type = 'revising'  then 'Time to revise. Tap to log it.'
        else 'Time for your ' || label || '. Tap to log it.'
      end
    );

    -- Which log buttons the native app shows under this push.
    select p.mode into mode from profiles p where p.id = r.user_id;

    perform public.send_push(
      array[r.user_id],
      jsonb_build_object(
        'title', coalesce(label || ' reminder', 'Reminder'),
        'body',  body,
        -- Typed reminders deep-link straight into the log sheet for that
        -- type; the id lets the page open it exactly once.
        'url',   case when r.entry_type is null
                      then '/today'
                      else '/today?log=' || r.entry_type || '&r=' || r.id::text end,
        -- Per-row tag on purpose: two reminders the same evening must stack
        -- in the tray, not replace each other (public/sw.js collapses by tag).
        'tag',   'day-reminder:' || r.id::text,
        'category', public.push_category(mode, r.entry_type)
      )
    );
  end loop;
end;
$$;

-- ── 2c. Daily reminders ─────────────────────────────────────────────────────
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
    select distinct on (p.id) p.id, p.timezone, p.mode, rem.time as remind_at
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
      jsonb_build_object(
        'title', 'Iqra',
        'body', line,
        'url', '/today',
        'tag', 'reminder',
        'category', public.push_category(r.mode, null)
      )
    );
  end loop;
end;
$$;

-- ── 2d. Sunset lapse nudge ──────────────────────────────────────────────────
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
        p.mode,
        (now() at time zone p.timezone)::date as local_today,
        extract(dow from (now() at time zone p.timezone))::int as local_dow,
        max((le.logged_at at time zone p.timezone)::date) as last_day
      from profiles p
      join log_entries le on le.user_id = p.id
      group by p.id, p.timezone, p.mode
    ),
    due as (
      select
        l.id,
        l.mode,
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
          -- Weekly phase: multiples of 7, ON ANY weekday. For a member
          -- whose last log was a Sunday these all land on Sundays, and a
          -- blanket stand-down would silence them forever.
          or ((l.local_today - l.last_day) > 30
              and (l.local_today - l.last_day) % 7 = 0)
        )
    )
    select id, mode, days_silent
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
        'tag', 'lapsed',
        'category', public.push_category(r.mode, null)
      )
    );
  end loop;
end;
$$;

-- ── 3. One Expo token belongs to one member ─────────────────────────────────
-- A phone has one Expo push token however many accounts sign in on it. The
-- app deletes its row before signing out, but a dead network or a session
-- that expired on its own can leave the previous member's row behind, and
-- then a reminder meant for them would reach the phone with the new member
-- signed in (the app also refuses to act on a push whose `uid` is not the
-- signed-in member). Server side: when a member registers a token, any other
-- member's row with that same token goes. Security definer because RLS lets
-- a member delete only their own rows. Web rows have no `expo` key and are
-- untouched.
create or replace function public.push_subscriptions_claim_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subscription ? 'expo' then
    delete from push_subscriptions ps
    where ps.user_id <> new.user_id
      and ps.subscription->>'expo' = new.subscription->>'expo';
  end if;
  return new;
end;
$$;

drop trigger if exists push_subscriptions_claim_token on public.push_subscriptions;
create trigger push_subscriptions_claim_token
  before insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_claim_token();

-- The cron schedules are untouched: pg_cron calls these by name, so the new
-- bodies take effect on the next tick. cron_streak_grace_nudge and
-- cron_weekly_recap are unchanged (no category, see the header).
