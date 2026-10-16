import { redirect } from "next/navigation";
import { ChartColumnBig } from "lucide-react";
import { getAuth, isOnboarded } from "@/lib/auth";
import {
  getMyMembership,
  getGroupMembers,
  getGroupEntries,
  getGroupPagesAllTime,
  getMyEntriesAllTime,
} from "@/lib/data";
import { Placeholder } from "@/components/Placeholder";
import { StatsClient } from "./StatsClient";

export default async function StatsPage() {
  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile) || !profile) redirect("/onboarding");

  const membership = await getMyMembership();
  if (!membership) {
    return (
      <Placeholder
        icon={ChartColumnBig}
        title="Insights"
        note="You’re not in a circle yet. Once you’re added and start logging, your charts show up here."
      />
    );
  }

  const [members, entries, readingAll, mine] = await Promise.all([
    getGroupMembers(membership.group_id),
    getGroupEntries(membership.group_id, 180),
    getGroupPagesAllTime(membership.group_id),
    getMyEntriesAllTime(membership.group_id, user.id),
  ]);

  return (
    <StatsClient
      mode={profile.mode}
      tz={profile.timezone}
      userId={user.id}
      members={members}
      entries={entries}
      readingAll={readingAll}
      mine={mine}
      mushaf={profile.mushaf ?? "uthmani15"}
    />
  );
}
