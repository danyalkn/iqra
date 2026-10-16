import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { getAuth, isOnboarded } from "@/lib/auth";
import {
  getMyMembership,
  getGroupMembers,
  getGroupMessages,
  getGroupReactions,
  getGroupChatReads,
} from "@/lib/data";
import { Placeholder } from "@/components/Placeholder";
import { ChatClient } from "./ChatClient";

export default async function ChatPage() {
  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile) || !profile) redirect("/onboarding");

  const membership = await getMyMembership();
  if (!membership) {
    return (
      <Placeholder
        icon={MessageCircle}
        title="Chat"
        note="You’re not in a circle yet. Ask the group owner to add you, then your shared chat shows up here."
      />
    );
  }

  const [members, messages, reactions, reads] = await Promise.all([
    getGroupMembers(membership.group_id),
    getGroupMessages(membership.group_id),
    getGroupReactions(membership.group_id),
    getGroupChatReads(membership.group_id),
  ]);

  return (
    <ChatClient
      groupId={membership.group_id}
      groupName={membership.group_name}
      tz={profile.timezone}
      userId={user.id}
      members={members}
      initialMessages={messages}
      initialReactions={reactions}
      initialReads={reads}
      initialNotifyChat={profile.notify_chat ?? true}
      isOwner={membership.role === "owner"}
    />
  );
}
