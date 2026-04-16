// Shared postMessage protocol between chat sidebar webview and host.
// No imports — pure type unions so webview can import without pulling
// host dependencies into the browser bundle.

export type CompletedTurn = {
  messageId: string;
  userText: string;
  assistantText: string;
  toolCalls: Array<{ name: string; input: unknown; resultContent: string; isError?: boolean }>;
};

export type ProactiveSuggestion = {
  id: string;
  text: string;
};

export type ContextSummary = {
  nodeCount: number;
  warningCount: number;
  errorCount: number;
  sessionId: string | null;
};

// ── Webview → Host ──

export type WebviewToHost =
  | { type: 'webview-ready' }
  | { type: 'user-turn'; text: string }
  | { type: 'cancel-turn' }
  | { type: 'accept-proactive-suggestion'; id: string };

// ── Host → Webview ──

export type HostToWebview =
  | { type: 'history'; turns: CompletedTurn[] }
  | { type: 'token'; text: string }
  | { type: 'tool-call'; callId: string; name: string; input: unknown }
  | { type: 'tool-result'; callId: string; name: string; content: string; isError?: boolean }
  | { type: 'turn-complete'; messageId: string }
  | { type: 'turn-cancelled' }
  | { type: 'history-cleared' }
  | { type: 'no-model' }
  | { type: 'engine-unavailable' }
  | { type: 'context-summary'; summary: ContextSummary }
  | { type: 'proactive-suggestion'; suggestion: ProactiveSuggestion };
