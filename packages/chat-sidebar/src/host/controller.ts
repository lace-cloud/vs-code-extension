// Thin wire-up between VS Code's webview + extension host and the
// IDE-agnostic chat machinery in @lace-cloud/chat-core.
//
// Responsibilities here — and only here:
//   1. Build the VS Code adapter + webview transport.
//   2. Consume the engine's Subscribe stream (BundleStateEvent), project
//      BundleState locally into a CanvasView, and expose both:
//        - `getCanvasView()` — synchronous snapshot of the latest view
//        - `awaitNextView()` — promise resolving on the next state update
//      so tools can read synchronously or wait for post-mutation state.
//   3. Own the engine session lifecycle for the chat (open session,
//      refresh context summary, mount proactivity).
//   4. Register the VS Code-side tool set on a per-instance
//      `ToolRegistry`.
//   5. Delegate the agentic loop to `AgentController` from chat-core.
//
// No agentic-loop logic, no message codecs, no rule evaluation. Those
// live in chat-core.

import {
  AgentController,
  buildSystemPrompt,
  createToolRegistry,
  formatCanvasState,
  ProactivityWatcher,
  type ToolRegistry,
} from '@lace-cloud/chat-core';
import type { BundleState, LaceTransport, RegistryModule } from '@lace-cloud/host';
import { SubscribeHandler } from '@lace-cloud/host';
import type { CanvasView } from '@lace-cloud/proto';
import { parseModuleKey, projectCanvasView } from '@lace-cloud/proto';
import * as vscode from 'vscode';
import { createVsCodeChatAdapter } from '../vscode-adapter';
import { createVsCodeWebviewTransport } from '../vscode-webview-transport';
import { registerGenerateTools } from './tools/generate-tools';
import { registerGraphReadTools } from './tools/graph-read-tools';
import { registerGraphWriteTools } from './tools/graph-write-tools';
import { registerRegistryTools } from './tools/registry-tools';
import { registerWorkspaceTools } from './tools/workspace-tools';

const HISTORY_STATE_KEY = 'lace.chatHistory';

export type ChatSidebarDeps = {
  getRpcClient: () => LaceTransport | null;
  getRegistryModules: () => RegistryModule[];
  getUserOrgs: () => Array<{ slug: string; name: string; role: string }>;
  getLaceDir: () => string | undefined;
};

export class ChatController {
  private readonly registry: ToolRegistry = createToolRegistry();
  private readonly agent: AgentController;
  private readonly outputChannel: vscode.OutputChannel;
  private latestView: CanvasView | null = null;
  private subscribeHandler: SubscribeHandler | null = null;
  private proactivity: ProactivityWatcher | null = null;
  private stateUpdateWaiters: Array<(view: CanvasView | null) => void> = [];

  constructor(
    context: vscode.ExtensionContext,
    webview: vscode.Webview,
    private readonly externalDeps: ChatSidebarDeps,
  ) {
    if (!ChatController.outputChannel) {
      ChatController.outputChannel = vscode.window.createOutputChannel('Lace Chat');
    }
    this.outputChannel = ChatController.outputChannel;

    const adapter = createVsCodeChatAdapter({ context, outputChannel: this.outputChannel });
    const transport = createVsCodeWebviewTransport(webview);

    this.registerTools();

    this.agent = new AgentController({
      adapter,
      transport,
      toolRegistry: this.registry,
      buildSystemPrompt,
      getAvailableSystems: () => [
        ...new Set(this.externalDeps.getRegistryModules().map((m) => m.system)),
      ],
      getCanvasView: () => this.latestView,
      historyKey: HISTORY_STATE_KEY,
    });
  }

  // Single static channel: VS Code collapses identical channel names
  // into one, but creating a new one per controller leaks the
  // dispose contract. Static ownership matches the pre-refactor
  // singleton behaviour with cleaner lifecycle.
  private static outputChannel: vscode.OutputChannel | undefined;

  /** Must be awaited after construction; hydrates history and subscribes. */
  async init(): Promise<void> {
    await this.agent.init();
    this.ensureSubscribe();
  }

  dispose(): void {
    this.agent.dispose();
    this.subscribeHandler?.stop();
    this.subscribeHandler = null;
    this.proactivity?.stop();
    this.proactivity = null;
    // Reject any pending awaiters so callers don't hang on dispose.
    for (const resolve of this.stateUpdateWaiters) resolve(null);
    this.stateUpdateWaiters = [];
  }

  async clearHistory(): Promise<void> {
    await this.agent.clearHistory();
  }

  getLatestView(): CanvasView | null {
    return this.latestView;
  }

  /**
   * Returns a promise that resolves on the NEXT BundleState arrival on
   * the Subscribe stream (with the newly-projected CanvasView, or null
   * if the stream ended / errored before the next event). Tools that
   * mutate state via applyAction call this BEFORE applyAction to set
   * up the waiter, then await the promise AFTER applyAction returns.
   */
  awaitNextView(): Promise<CanvasView | null> {
    return new Promise((resolve) => {
      this.stateUpdateWaiters.push(resolve);
    });
  }

  // ── Private ──

  private registerTools(): void {
    const deps = {
      ...this.externalDeps,
      getCanvasView: () => this.latestView,
      awaitNextView: () => this.awaitNextView(),
    };
    registerRegistryTools(this.registry, deps);
    registerGraphReadTools(this.registry, deps);
    registerGraphWriteTools(this.registry, deps);
    registerGenerateTools(this.registry, deps);
    registerWorkspaceTools(this.registry);
  }

  private ensureSubscribe(): void {
    if (this.subscribeHandler) return;
    const transport = this.externalDeps.getRpcClient();
    if (!transport?.sessionId) {
      void this.ensureSession().then(() => this.openSubscribe());
      return;
    }
    this.openSubscribe();
  }

  private async ensureSession(): Promise<string | null> {
    const transport = this.externalDeps.getRpcClient();
    if (!transport) return null;
    if (transport.sessionId) return transport.sessionId;

    const laceDir = this.externalDeps.getLaceDir();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!laceDir || !workspaceFolder) return null;

    const { session_id, state } = await transport.sessionOpen({
      file_path: laceDir,
      workspace_name: workspaceFolder.name,
    });
    this.adoptState(state);
    return session_id;
  }

  private openSubscribe(): void {
    const transport = this.externalDeps.getRpcClient();
    if (!transport?.sessionId) {
      this.agent.postEngineUnavailable();
      return;
    }

    this.subscribeHandler = new SubscribeHandler();
    this.subscribeHandler.start(transport.subscribeStream(transport.sessionId), {
      onStateUpdated: (state) => this.adoptState(state),
      onGenerateProgress: () => {},
      onGenerateSuccess: () => {},
      onGenerateError: () => {},
      onPolicyResolution: () => {},
      onEnd: () => {
        this.subscribeHandler = null;
      },
      onError: () => {
        this.subscribeHandler = null;
        // Avoid tight retry loops — if the engine dies mid-session, the
        // next user turn will attempt to re-establish the session.
      },
    });

    this.proactivity = new ProactivityWatcher({
      transport,
      sessionId: transport.sessionId,
      adapter: {
        getConfig: (key, defaultValue) =>
          vscode.workspace.getConfiguration('lace.chat').get(key, defaultValue),
        log: (msg) => this.outputChannel.appendLine(msg),
      },
      onSuggestion: (s) => this.agent.postProactiveSuggestion(s),
    });
    this.proactivity.start();
  }

  private adoptState(state: BundleState): void {
    if (!state.bundle) return;
    const { id: moduleName } = parseModuleKey(state.bundle.entry);
    const view = projectCanvasView(state.bundle, state.layouts ?? {}, {
      moduleName,
      canUndo: state.can_undo,
      canRedo: state.can_redo,
      isDirty: state.is_dirty,
    });
    this.latestView = view;
    this.postContextSummary();

    const waiters = this.stateUpdateWaiters;
    this.stateUpdateWaiters = [];
    for (const resolve of waiters) resolve(view);
  }

  private postContextSummary(): void {
    const view = this.latestView;
    const transport = this.externalDeps.getRpcClient();
    if (!view) return;
    this.agent.postContextSummary({
      nodeCount: view.nodes.length,
      // CanvasView carries `errors` but no separate warnings field today;
      // the ContextSummary slot exists for future use. Match the
      // pre-refactor controller which also sent 0.
      warningCount: 0,
      errorCount: view.errors.length,
      sessionId: transport?.sessionId ?? null,
    });
    // Log a summary line so telemetry captures context transitions.
    this.outputChannel.appendLine(formatCanvasState(view, { compact: true }));
  }
}
