// Public surface of @lace/chat-webview.
//
// The chat UI as a library. Consumers are IDE-specific webview
// entries (VS Code, JetBrains) that create the thin transport
// bridge and mount `<App bridge={...} />`. All protocol types come
// from `@lace/chat-core` — chat-webview re-exports them for
// convenience.

// Consumers usually only need the bridge + App; re-export the
// protocol types so IDE entries don't have to import from two
// places.
export type {
  CompletedTurn,
  ContextSummary,
  HostToWebview,
  ProactiveSuggestion,
  WebviewToHost,
} from '@lace/chat-core';
export { App, type WebviewBridge } from './App';
export type { ThreadMessage } from './components/Thread';
