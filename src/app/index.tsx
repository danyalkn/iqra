import { Redirect } from "expo-router";

/** `/` (cold launch, `iqra://`) lands on Today, like the web root route.
 *  Guarded with the tabs in the root layout, so a signed-out launch is sent
 *  to login by the gate instead. */
export default function Index() {
  return <Redirect href="/today" />;
}
