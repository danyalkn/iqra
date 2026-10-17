// App entry. The Android notification task must be defined at module scope
// in a file required before anything renders (expo-notifications docs), so
// it comes first; the router entry then registers the root component.
import "./src/push/task";
import "expo-router/entry";
