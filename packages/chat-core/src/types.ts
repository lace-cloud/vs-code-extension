// Core chat types — vscode-free, JSON-safe, IDE-agnostic.
//
// Every type in this file is a plain data union: it survives
// `JSON.stringify` / `JSON.parse` without losing information, so
// history persistence is a direct pass-through and adapter boundaries
// have nothing exotic to marshal.

// ── Message parts ──
//
// Matches what a language model streams back during a turn: plain
// text output, requests to invoke a tool, and the result of a tool
// invocation. IDE adapters map their native model APIs onto this
// shape at the boundary.

export type TextPart = { kind: 'text'; value: string };

export type ToolCallPart = {
  kind: 'tool-call';
  callId: string;
  name: string;
  input: unknown;
};

export type ToolResultPart = {
  kind: 'tool-result';
  callId: string;
  content: TextPart[];
  isError?: boolean;
};

export type Part = TextPart | ToolCallPart | ToolResultPart;

// ── Messages ──
//
// A ChatMessage is the atom the adapter's `sendRequest` operates on.
// History is a `ChatMessage[]` — JSON-safe by construction, so
// persistence is `JSON.stringify` away.

export type ChatMessageRole = 'user' | 'assistant';

export type ChatMessage = {
  role: ChatMessageRole;
  content: Part[];
};

// ── Stream events ──
//
// As the model streams, the adapter yields events in turn. Core
// consumes these to drive the agentic loop (emit tokens to the UI,
// accumulate tool calls, etc.). Tool-result parts never appear in the
// stream — core synthesizes them after dispatching tools.

export type ChatStreamEvent =
  | { type: 'text'; value: string }
  | { type: 'tool-call'; callId: string; name: string; input: unknown };

// ── Tool schema ──
//
// JSON schema shape the LLM sees. Mirrors
// `vscode.LanguageModelChatTool` / similar structures in other IDE
// APIs, but stays decoupled.

export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolResult = {
  content: string;
  isError?: boolean;
};

// ── Model handle ──
//
// Opaque brand type. Adapters return model instances through this
// handle and receive them back unchanged. Core never inspects the
// underlying value — it just carries the reference through the loop.

export type ChatModel = { readonly __chatModelBrand: unique symbol };

// ── Disposable ──
//
// Matches the `vscode.Disposable` shape but doesn't require vscode.
// Use for anything the adapter returns that needs cleanup.

export interface Disposable {
  dispose(): void;
}
