// @lace-cloud/chat-sidebar — VS Code adapter for the chat UI.
//
// This package is the VS Code implementation of chat-core's
// adapter contracts. Public surface is intentionally small: host
// activation constructs a ChatViewProvider and registers it with
// VS Code's webview view registry. The controller inside does the
// rest (constructs the adapter, transport, tool registry, agent
// controller, and proactivity watcher).

export type { ChatSidebarDeps } from './host/controller';
export { type BuildWebviewHtml, ChatViewProvider } from './host/view-provider';
