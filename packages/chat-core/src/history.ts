// History helpers.
//
// `ChatMessage[]` is JSON-safe by construction — every `Part`
// variant is plain data. There is deliberately no codec here: the
// adapter persists whatever core gives it and loads it back
// unchanged. The single concern is keeping persisted history
// bounded so it doesn't grow without end.

import type { ChatMessage } from './types';

const DEFAULT_TURN_CAP = 50;

/**
 * Trim message history to the most recent `turnCap` turns. A turn
 * is one user message followed by one assistant message (plus any
 * interleaved tool traffic the assistant emits). Keeping the last
 * `turnCap` turns is approximated by keeping `turnCap * 2` messages
 * — exact turn boundaries aren't worth tracking for a bounded cap.
 */
export function capRecentMessages(
  messages: ChatMessage[],
  turnCap = DEFAULT_TURN_CAP,
): ChatMessage[] {
  const limit = turnCap * 2;
  if (messages.length <= limit) return messages;
  return messages.slice(messages.length - limit);
}
