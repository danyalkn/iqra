import { TextInput } from "react-native";

/** RN 0.88 host elements are DOM-like nodes; the TS types lag behind. */
type MaybeNode = { contains?: (other: unknown) => boolean };

/**
 * The focused text field when it lives inside `host` (a host component ref),
 * else null. Where the DOM node API is missing, any focused field counts as
 * inside, which is the old behaviour.
 */
export function focusedInputWithin(host: unknown) {
  const input = TextInput.State.currentlyFocusedInput();
  if (!input || !host) return null;
  const contains = (host as MaybeNode).contains;
  if (contains && !contains.call(host, input)) return null;
  return input;
}
