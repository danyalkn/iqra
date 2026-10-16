import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuth, isOnboarded } from "@/lib/auth";

/** Entry router: send people to login → onboarding → the app, in order. */
export default async function Home() {
  if (!isSupabaseConfigured()) redirect("/login");

  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile)) redirect("/onboarding");
  redirect("/today");
}
