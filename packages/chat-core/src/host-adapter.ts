// The primary IDE contract. Every IDE that embeds chat provides a
// ChatHostAdapter; the agentic loop in `AgentController` talks to the
// IDE exclusively through this interface.
//
// The methods collectively cover: model access, request streaming,
// history persistence, configuration, workspace identity, and
// logging. Anything that would otherwise require `import * as vscode`
// (or the JetBrains equivalent) funnels through here.

import type { ChatMessage, ChatModel, ChatStreamEvent, ToolSchema } from './types';

export interface ChatHostAdapter {
  /**
   * Resolve the default chat model for a turn. Return `null` if no
   * model is available (the agentic loop will emit a `no-model`
   * event to the webview).
   */
  selectModel(): Promise<ChatModel | null>;

  /**
   * Send a request to the model and stream events back. The
   * returned async iterable must yield events for each part the
   * model produces. Tool-result parts are *not* yielded — core
   * synthesizes those after dispatching the tools itself.
   *
   * The adapter is responsible for honouring `signal` (cancelling
   * the in-flight request when it fires) and for mapping its
   * native model stream onto {@link ChatStreamEvent}.
   */
  sendRequest(
    model: ChatModel,
    messages: ChatMessage[],
    tools: ToolSchema[],
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent>;

  /**
   * Persist history under the given key. The adapter picks the
   * storage surface — VS Code uses `context.workspaceState`;
   * JetBrains would use `PropertiesComponent` or similar.
   *
   * `messages` is JSON-safe by construction (all `Part` variants
   * are plain data), so implementations can stringify directly.
   */
  saveHistory(key: string, messages: ChatMessage[]): Promise<void>;

  /** Restore history previously persisted under `key`. Returns `null` if absent. */
  loadHistory(key: string): Promise<ChatMessage[] | null>;

  /**
   * Read a user-visible configuration value, scoped to the chat
   * subsystem. `key` is dot-separated (e.g. `'proactivity'`); the
   * adapter maps it onto its native config system.
   */
  getConfig<T>(key: string, defaultValue: T): T;

  /** Current workspace name, used to label the engine session. `null` outside a workspace. */
  getWorkspaceName(): string | null;

  /** Write to the IDE's log surface (VS Code OutputChannel, JetBrains Logger, etc.). */
  log(message: string): void;
}
