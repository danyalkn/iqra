/** Date helpers that respect each user's IANA timezone (streaks + "today"
 *  are local-day concepts). No external date library needed. */

/** One formatter per timezone: building an Intl formatter is the expensive
 *  part, and the stats pages convert thousands of timestamps. */
const YMD_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** Local calendar date (YYYY-MM-DD) of an instant, in the given timezone. */
export function localDate(ts: string | number | Date, tz: string): string {
  let f = YMD_FORMATTERS.get(tz);
  if (!f) {
    // en-CA renders as YYYY-MM-DD.
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    YMD_FORMATTERS.set(tz, f);
  }
  return f.format(new Date(ts));
}

/** Today's local date (YYYY-MM-DD) in the given timezone. */
export function todayLocal(tz: string): string {
  return localDate(new Date(), tz);
}

/** The clock, for a server page to hand a client component as a prop so the
 *  server HTML and the first client paint agree on "now" (which reminders
 *  are already due). Server pages render once per request, so there is no
 *  re-render purity concern; this just keeps the read out of JSX. */
export function nowMs(): number {
  return Date.now();
}

/** Yesterday's local date (YYYY-MM-DD) in the given timezone. */
export function yesterdayLocal(tz: string): string {
  return prevYmd(todayLocal(tz));
}

/** Tomorrow's local date (YYYY-MM-DD) in the given timezone. */
export function tomorrowLocal(tz: string): string {
  return nextYmd(todayLocal(tz));
}

/** Local wall-clock time ("HH:MM", 24h) of an instant, in the given timezone.
 *  Sortable and storable, unlike the display-only `timeLabel`. */
export function localHm(ts: string | number | Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ts));
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  // Some engines still render midnight as 24 - fold it (see tzOffsetMs).
  return `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}`;
}

/** How far `tz` is ahead of UTC at a given instant, in ms. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const asIfUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour % 24, // some locales render midnight as 24
    +p.minute,
    +p.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * ISO instant for a wall-clock time in a specific timezone - e.g. "8pm on
 * 2026-07-28 in Asia/Karachi". Needed because backdated entries must land on
 * the right *profile-local* day, and the device may be in another zone.
 * Two passes so the offset is read at (close to) the target instant, which
 * keeps it correct across DST boundaries.
 */
export function zonedIso(
  ymd: string,
  hour: number,
  tz: string,
  minute = 0,
): string {
  const naive = Date.UTC(
    +ymd.slice(0, 4),
    +ymd.slice(5, 7) - 1,
    +ymd.slice(8, 10),
    hour,
    minute,
  );
  let ts = naive - tzOffsetMs(new Date(naive), tz);
  ts = naive - tzOffsetMs(new Date(ts), tz);

  // A spring-forward can make the requested wall time nonexistent (e.g. 00:00
  // in Santiago on a transition date), which would resolve onto the previous
  // day - the one thing this helper must never do. Step forward until the
  // instant really is on the intended local date.
  for (let i = 0; i < 4 && localDate(ts, tz) !== ymd; i++) {
    ts += 60 * 60 * 1000;
  }
  return new Date(ts).toISOString();
}

/* Umm al-Qura month names, in the transliteration this circle actually uses
 * (Intl's own are the terser "Rabiʻ I" style). Index = Hijri month - 1. */
const HIJRI_MONTHS = [
  "Muharram",
  "Safar",
  "Rabi’ al-Awwal",
  "Rabi’ al-Thani",
  "Jumada al-Ula",
  "Jumada al-Akhirah",
  "Rajab",
  "Sha’ban",
  "Ramadan",
  "Shawwal",
  "Dhul-Qa’dah",
  "Dhul-Hijjah",
];

/** Hijri date like "26 Rabi’ al-Awwal 1448 AH" for an instant, in the given
 *  timezone (Umm al-Qura calendar via Intl). Empty string if the runtime has
 *  no Islamic calendar data, so callers can simply hide it. */
export function hijriDate(ts: string | number | Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      timeZone: tz,
      day: "numeric",
      month: "numeric",
      year: "numeric",
    }).formatToParts(new Date(ts));
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    const month = HIJRI_MONTHS[+p.month - 1];
    if (!month || !p.day || !p.year) return "";
    return `${+p.day} ${month} ${p.year} AH`;
  } catch {
    return "";
  }
}

/* Fixed English names for the short labels below. Intl's en-GB output
 * differs between engines (Node prints "Mon 31 Aug" and "Sept", browsers
 * "Mon, 31 Aug"), and those labels are rendered on the server AND the client,
 * so any difference is a hydration mismatch. Spelling them out keeps both
 * sides identical. */
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Short label like "Mon, 6 Jun" for a local date string. */
export function dayLabel(ymd: string): string {
  // Parse as a local-noon date to avoid TZ drift on the label itself.
  const d = new Date(`${ymd}T12:00:00`);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** Time label like "6:12 AM" for an instant in the given timezone. */
export function timeLabel(ts: string | number | Date, tz: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * iMessage-style separator label for a chat time break, in the user's tz:
 * "Today 6:12 AM", "Yesterday 9:01 PM", "Wed 3:14 PM" (this week), or
 * "12 May, 4:00 PM" / "12 May 2025, 4:00 PM" (older).
 */
export function chatStamp(ts: string | number | Date, tz: string): string {
  const ymd = localDate(ts, tz);
  const today = todayLocal(tz);
  const time = timeLabel(ts, tz);
  if (ymd === today) return `Today ${time}`;
  if (ymd === prevYmd(today)) return `Yesterday ${time}`;

  const dThen = new Date(`${ymd}T12:00:00`);
  const dToday = new Date(`${today}T12:00:00`);
  const diffDays = Math.round((dToday.getTime() - dThen.getTime()) / 86_400_000);
  if (diffDays > 1 && diffDays < 7) {
    return `${dThen.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  }
  const sameYear = dThen.getFullYear() === dToday.getFullYear();
  const date = dThen.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}

function prevYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}

/** Yesterday stays loggable until this local time the next morning (people
 *  often read past midnight). The database trigger log_entries_backdate_guard
 *  enforces the same cutoff. */
export const BACKDATE_CUTOFF = "03:00";

/**
 * Current streak = consecutive local days with ≥1 entry, counting back from
 * today (or from yesterday if nothing logged yet today, so the streak doesn't
 * read 0 until a full day is actually missed). Before 3 AM yesterday can
 * still be logged, so a streak that ran through the day before isn't broken
 * yet either - this matches the midnight "you have until 3 AM" push.
 */
export function currentStreak(loggedDays: Set<string>, tz: string): number {
  const today = todayLocal(tz);
  let cursor = loggedDays.has(today) ? today : prevYmd(today);
  if (
    !loggedDays.has(cursor) &&
    cursor !== today &&
    localHm(new Date(), tz) < BACKDATE_CUTOFF
  ) {
    cursor = prevYmd(cursor);
  }
  if (!loggedDays.has(cursor)) return 0;
  let streak = 0;
  while (loggedDays.has(cursor)) {
    streak += 1;
    cursor = prevYmd(cursor);
  }
  return streak;
}

/** Longest run of consecutive local days in the set. */
export function longestStreak(loggedDays: Set<string>): number {
  let best = 0;
  for (const day of loggedDays) {
    // Only start counting from the beginning of a run.
    if (loggedDays.has(prevYmd(day))) continue;
    let run = 0;
    let cursor = day;
    while (loggedDays.has(cursor)) {
      run += 1;
      cursor = nextYmd(cursor);
    }
    if (run > best) best = run;
  }
  return best;
}

/** The local date after `ymd` (YYYY-MM-DD). */
export function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}

/** The last `n` local dates (YYYY-MM-DD), oldest → newest, ending today. */
export function lastNDays(tz: string, n: number): string[] {
  return lastNDaysEndingOn(todayLocal(tz), n);
}

/** As `lastNDays`, but ending on an explicit date. Prefer this inside memos:
 *  the window then depends on a value React can see, not a hidden clock read. */
export function lastNDaysEndingOn(endYmd: string, n: number): string[] {
  const out: string[] = [];
  let cursor = endYmd;
  for (let i = 0; i < n; i++) {
    out.push(cursor);
    cursor = prevYmd(cursor);
  }
  return out.reverse();
}

/* ── Calendar periods ───────────────────────────────────────────────────────
 * Weeks and months are real calendar periods, not rolling N-day windows: the
 * current week runs Monday → today, the current month runs the 1st → today,
 * and past periods are whole. A rolling window answers "the last 7 days",
 * which is a different (and less intuitive) question than "this week". */

/** Monday of the week containing `ymd` (ISO weeks - Monday is day 1). */
export function startOfWeek(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  // getDay(): 0=Sun … 6=Sat. Sunday belongs to the week that began 6 days ago.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.toLocaleDateString("en-CA");
}

/** Every date in the week containing `ymd`, Monday → Sunday. */
export function weekDates(ymd: string): string[] {
  const start = startOfWeek(ymd);
  const out: string[] = [start];
  for (let i = 1; i < 7; i++) out.push(nextYmd(out[i - 1]));
  return out;
}

/** The week containing `ymd`, but never past `upTo` (so the current week ends
 *  today rather than running into the future). */
export function weekDatesUpTo(ymd: string, upTo: string): string[] {
  return weekDates(ymd).filter((d) => d <= upTo);
}

/** Monday of the week `n` weeks before the one containing `ymd`. */
export function addWeeks(ymd: string, n: number): string {
  const d = new Date(`${startOfWeek(ymd)}T12:00:00`);
  d.setDate(d.getDate() + n * 7);
  return d.toLocaleDateString("en-CA");
}

/** Month key ("YYYY-MM") of a local date string. */
export function monthKey(ymd: string): string {
  return ymd.slice(0, 7);
}

/** Shift a "YYYY-MM" key by `n` months. */
export function addMonths(key: string, n: number): string {
  const d = new Date(`${key}-01T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString("en-CA").slice(0, 7);
}

/** Every date in month `key` ("YYYY-MM"), 1st → last, capped at `upTo`. */
export function monthDates(key: string, upTo?: string): string[] {
  const [y, m] = [+key.slice(0, 4), +key.slice(5, 7)];
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let day = 1; day <= last; day++) {
    const ymd = `${key}-${String(day).padStart(2, "0")}`;
    if (upTo && ymd > upTo) break;
    out.push(ymd);
  }
  return out;
}

/** "July" for the current year, "July 2025" otherwise. */
export function monthLabel(key: string, todayYmd: string): string {
  const d = new Date(`${key}-01T12:00:00`);
  const sameYear = key.slice(0, 4) === todayYmd.slice(0, 4);
  return d.toLocaleDateString("en-GB", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "6–12 Jul" style label for a week starting on `startYmd`. */
export function weekRangeLabel(startYmd: string, endYmd: string): string {
  // A week-to-date range is a single day every Monday - don't print "27–27 Jul".
  if (startYmd === endYmd) return shortDate(startYmd);
  const a = new Date(`${startYmd}T12:00:00`);
  const b = new Date(`${endYmd}T12:00:00`);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = sameMonth
    ? String(a.getDate())
    : `${a.getDate()} ${MONTH_SHORT[a.getMonth()]}`;
  return `${left}–${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
}

/** "6 Jun" short date for a local date string. */
export function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** Single-letter weekday for a local date string (M/T/W…). */
export function weekdayInitial(ymd: string): string {
  return ["S", "M", "T", "W", "T", "F", "S"][
    new Date(`${ymd}T12:00:00`).getDay()
  ];
}
