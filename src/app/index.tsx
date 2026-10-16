import { Redirect } from "expo-router";

import { useSession } from "@/providers/SessionProvider";

/**
 * The app's anchor route. It is never guarded, so a cold start at `/`
 * (and every guarded route's fallback) always has somewhere to land while
 * the session is still loading; the splash screen covers that moment. Once
 * the session is known it sends people on, mirroring the web root route:
 * login -> onboarding -> the app.
 */
export default function Index() {
  const { loading, session, isOnboarded } = useSession();
  if (loading) return null;
  if (!session) return <Redirect href="/login" />;
  if (!isOnboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/today" />;
}
