import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAuth, isOnboarded } from "@/lib/auth";
import { getMyReminders } from "@/lib/data";
import { ProfileSection } from "@/components/ProfileSection";
import { RemindersManager } from "@/components/RemindersManager";
import { NotificationsToggle } from "@/components/NotificationsToggle";
import { CelebrateToggle } from "@/components/CelebrateToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MushafSelect } from "@/components/MushafSelect";
import { SignOutButton } from "@/components/SignOutButton";
import { DeleteAccount } from "@/components/DeleteAccount";
import { BUILD } from "@/lib/build";

export default async function SettingsPage() {
  const { user, profile } = await getAuth();
  if (!user) redirect("/login");
  if (!isOnboarded(profile) || !profile) redirect("/onboarding");

  const reminders = await getMyReminders(user.id);

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-10">
      <header className="flex items-center gap-3 px-5 pt-7 pb-3">
        <Link
          href="/today"
          aria-label="Back"
          className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-title1">Settings</h1>
      </header>

      <div className="space-y-6 px-5 pt-2">
        <ProfileSection
          userId={user.id}
          email={user.email ?? ""}
          initial={{
            display_name: profile.display_name ?? "You",
            mode: profile.mode,
            timezone: profile.timezone,
            avatar_url: profile.avatar_url,
          }}
        />

        <MushafSelect userId={user.id} initial={profile.mushaf ?? "uthmani15"} />

        <ThemeToggle />

        <NotificationsToggle userId={user.id} />

        <CelebrateToggle />

        <RemindersManager userId={user.id} initial={reminders} />

        <div className="space-y-1 pt-2">
          <SignOutButton />
          <DeleteAccount />
        </div>

        <p className="pt-2 text-center text-caption text-faint">
          Iqra · build {BUILD}
        </p>
      </div>
    </div>
  );
}
