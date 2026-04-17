// Public surface of @lace/chat-core.
//
// Everything IDE-agnostic: the agentic loop, adapter contracts,
// tool registry, proactivity engine + rules, protocol types for the
// webview, and shared utilities. IDE-specific adapters (VS Code,
// JetBrains, ...) depend on this package and implement the three
// interfaces exposed here.

// ── Agent controller ──
export { AgentController, type AgentControllerOptions } from './agent-controller';
export type { FileSystemAdapter } from './filesystem-adapter';
// ── History helpers ──
export { capRecentMessages } from './history';
// ── Adapter contracts ──
export type { ChatHostAdapter } from './host-adapter';
// ── Proactivity ──
export {
  advanceState,
  type EngineEventLike,
  initialRuleState,
  matchAll,
  matchErrorsAppeared,
  matchGenerateError,
  matchUnwiredRequiredInput,
  ProactivityWatcher,
  type ProactivityWatcherOptions,
  type RuleState,
} from './proactivity';
// ── Protocol (shared with @lace/chat-webview) ──
export type {
  CompletedTurn,
  ContextSummary,
  HostToWebview,
  ProactiveSuggestion,
  WebviewToHost,
} from './protocol';
// ── System prompt ──
export { buildSystemPrompt } from './system-prompt';
// ── Telemetry ──
export {
  createTelemetry,
  type SessionMetadata,
  type Telemetry,
  type ToolInvocationRecord,
} from './telemetry';
// ── Tool registry ──
export {
  createToolRegistry,
  type ToolHandler,
  type ToolRegistration,
  type ToolRegistry,
} from './tool-registry';
// ── Types ──
export type {
  ChatMessage,
  ChatMessageRole,
  ChatModel,
  ChatStreamEvent,
  Disposable,
  Part,
  TextPart,
  ToolCallPart,
  ToolResult,
  ToolResultPart,
  ToolSchema,
} from './types';

// ── Canvas summary ──
export { formatCanvasState } from './utils/canvas-summary';
export type { WebviewTransport } from './webview-transport';
