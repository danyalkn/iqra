import { redirect } from "next/navigation";
import { getAuth, isOnboarded } from "@/lib/auth";
import {
  getMyDayReminders,
  getMyMembership,
  getMyRecentEntries,
} from "@/lib/data";
import { TYPES_BY_MODE, type EntryType } from "@/lib/entries";
import { nowMs, todayLocal, tomorrowLocal } from "@/lib/dates";
import { TodayClient } from "./TodayClient";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ log?: string | string[]; r?: string | string[] }>;
}) {
  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile) || !profile) redirect("/onboarding");

  // A reminder push deep-links to /today?log=<type>&r=<reminder id> so the
  // log sheet opens straight away. Untrusted: only a type this mode actually
  // offers counts, and the id is only ever used as an opaque "opened once"
  // key on the client.
  const { log, r } = await searchParams;
  const rawLog = Array.isArray(log) ? log[0] : log;
  const rawKey = Array.isArray(r) ? r[0] : r;
  const openLog: EntryType | null =
    rawLog && (TYPES_BY_MODE[profile.mode] as string[]).includes(rawLog)
      ? (rawLog as EntryType)
      : null;
  const openLogKey = openLog && rawKey && UUID.test(rawKey) ? rawKey : null;

  const membership = await getMyMembership();
  const tz = profile.timezone;
  const [entries, dayReminders] = membership
    ? await Promise.all([
        getMyRecentEntries(membership.group_id, user.id),
        getMyDayReminders(user.id, todayLocal(tz), tomorrowLocal(tz)),
      ])
    : [[], []];

  return (
    <TodayClient
      mode={profile.mode}
      tz={tz}
      displayName={profile.display_name ?? "You"}
      avatarUrl={profile.avatar_url}
      userId={user.id}
      groupId={membership?.group_id ?? null}
      initialEntries={entries}
      initialDayReminders={dayReminders}
      serverNow={nowMs()}
      openLog={openLog}
      openLogKey={openLogKey}
      mushaf={profile.mushaf ?? "uthmani15"}
    />
  );
}
