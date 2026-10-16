import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAuth, isOnboarded } from "@/lib/auth";
import { AppFrame } from "./AppFrame";

/** Shell for the authenticated app: gates access, then frames children with
 *  the bottom tab bar. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) redirect("/login");

  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile)) redirect("/onboarding");

  return <AppFrame>{children}</AppFrame>;
}
