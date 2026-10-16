import { redirect } from "next/navigation";
import { NotebookPen } from "lucide-react";
import { getAuth, isOnboarded } from "@/lib/auth";
import { getMyEntriesAllTime, getMyMembership } from "@/lib/data";
import { Placeholder } from "@/components/Placeholder";
import { JournalClient } from "./JournalClient";

/** Everything you've ever logged, with your notes - Today only shows today. */
export default async function JournalPage() {
  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile) || !profile) redirect("/onboarding");

  const membership = await getMyMembership();
  if (!membership) {
    return (
      <Placeholder
        icon={NotebookPen}
        title="Journal"
        note="You’re not in a circle yet. Once you’re added and start logging, every entry and note you write collects here."
      />
    );
  }

  const entries = await getMyEntriesAllTime(membership.group_id, user.id);

  return (
    <JournalClient
      mode={profile.mode}
      tz={profile.timezone}
      mushaf={profile.mushaf ?? "uthmani15"}
      initialEntries={entries}
    />
  );
}
