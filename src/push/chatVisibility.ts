/**
 * Whether the Chat tab is on screen right now. The notification handler
 * (PushController) reads it synchronously to decide whether a `chat-*` push
 * should show a banner: a message that is already visible in the open chat
 * needs no alert, exactly as the web suppressed them while the chat page had
 * focus. The Chat screen writes it from its focus and AppState tracking.
 *
 * A module-level flag rather than React state because the handler runs
 * outside the tree and must answer within expo-notifications' 3 s budget.
 */
let chatVisible = false;

export function setChatVisible(visible: boolean): void {
  chatVisible = visible;
}

export function isChatVisible(): boolean {
  return chatVisible;
}
