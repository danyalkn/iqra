import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuth, isOnboarded } from "@/lib/auth";
import { OnboardingFlow } from "./OnboardingFlow";

export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect("/login");

  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (isOnboarded(profile)) redirect("/today");

  return (
    <OnboardingFlow
      userId={user.id}
      email={user.email ?? ""}
      initial={profile}
    />
  );
}
