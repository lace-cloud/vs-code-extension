// Thin wire-up between VS Code's webview + extension host and the
// IDE-agnostic chat machinery in @lace/chat-core.
//
// Responsibilities here — and only here:
//   1. Build the VS Code adapter + webview transport.
//   2. Maintain the latest CanvasView by consuming the engine's
//      Subscribe stream (so tools can read it synchronously via
//      `deps.getCanvasView`).
//   3. Own the engine session lifecycle for the chat (open session,
//      refresh context summary, mount proactivity).
//   4. Register the VS Code-side tool set on a per-instance
//      `ToolRegistry`.
//   5. Delegate the agentic loop to `AgentController` from chat-core.
//
// No agentic-loop logic, no message codecs, no rule evaluation. Those
// live in chat-core. When we port to JetBrains, this file is the
// shape the JetBrains controller mirrors — the rest is unchanged.

import {
  AgentController,
  buildSystemPrompt,
  createToolRegistry,
  formatCanvasState,
  ProactivityWatcher,
  type ToolRegistry,
} from '@lace/chat-core';
import type { CanvasView, EngineEvent, LaceTransport, RegistryModule } from '@lace/host';
import { convertCanvasView } from '@lace/host';
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
  private subscribeHandler: ReturnType<LaceTransport['subscribeStream']> | null = null;
  private proactivity: ProactivityWatcher | null = null;

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
    this.subscribeHandler?.cancel();
    this.subscribeHandler = null;
    this.proactivity?.stop();
    this.proactivity = null;
  }

  async clearHistory(): Promise<void> {
    await this.agent.clearHistory();
  }

  getLatestView(): CanvasView | null {
    return this.latestView;
  }

  // ── Private ──

  private registerTools(): void {
    const deps = {
      ...this.externalDeps,
      getCanvasView: () => this.latestView,
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
      // Attempt a lazy session-open so the Subscribe stream is
      // available from the first turn. If no workspace is open or
      // the engine isn't running, the runTurn path surfaces the
      // error to the webview.
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

    const { session_id } = await transport.sessionOpen({
      file_path: laceDir,
      workspace_name: workspaceFolder.name,
    });
    return session_id;
  }

  private openSubscribe(): void {
    const transport = this.externalDeps.getRpcClient();
    if (!transport?.sessionId) {
      this.agent.postEngineUnavailable();
      return;
    }

    this.subscribeHandler = transport.subscribeStream(transport.sessionId);
    this.subscribeHandler.on('data', (event: EngineEvent) => this.handleEngineEvent(event));
    this.subscribeHandler.on('end', () => {
      this.subscribeHandler = null;
    });
    this.subscribeHandler.on('error', () => {
      this.subscribeHandler = null;
      // Avoid tight retry loops — if the engine dies mid-session, the
      // next user turn will attempt to re-establish the session.
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

  private handleEngineEvent(event: EngineEvent): void {
    if (event.state_updated?.view) {
      this.latestView = convertCanvasView(event.state_updated.view);
      this.postContextSummary();
    }
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
