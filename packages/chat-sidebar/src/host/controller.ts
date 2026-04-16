import * as vscode from 'vscode';
import type { LaceTransport, CanvasView } from '@lace/host';
import type { EngineEvent } from '@lace/host';
import type { ToolDeps, ToolResult } from './types';
import type { WebviewToHost, HostToWebview, CompletedTurn, ContextSummary } from '../protocol';
import { buildSystemPrompt } from './system-prompt';
import { getToolHandler } from './tool-registry';
import { startSession, endSession, logToolInvocation } from './telemetry';
import { serialize, hydrate, capToRecent, type SerializedMessage } from './history-codec';
import { ProactivityWatcher } from './proactivity';

const MAX_TOOL_ROUNDS = 25;
const HISTORY_STATE_KEY = 'lace.chatHistory';

/**
 * Host-side agentic loop + sidebar lifecycle. Instantiated per webview
 * resolution by ChatViewProvider. Subscribes to the engine stream,
 * maintains latest canvas view, drives proactivity, persists history.
 */
export class ChatController {
  private history: vscode.LanguageModelChatMessage[] = [];
  private completedTurns: CompletedTurn[] = [];
  private activeTurn: AbortController | null = null;
  private subscribeHandler: ReturnType<LaceTransport['subscribeStream']> | null = null;
  private latestView: CanvasView | null = null;
  private proactivity: ProactivityWatcher | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly webview: vscode.Webview,
    private readonly deps: ToolDeps,
    private readonly log: (msg: string) => void,
  ) {
    this.restoreHistory();
    this.webview.onDidReceiveMessage((msg: WebviewToHost) => this.handleMessage(msg));
  }

  /** Exposed to tools via deps.getCanvasView — returns cached latest view. */
  getLatestView(): CanvasView | null {
    return this.latestView;
  }

  /** Called by ChatViewProvider on dispose. */
  dispose(): void {
    this.activeTurn?.abort();
    this.subscribeHandler?.cancel();
    this.subscribeHandler = null;
    this.proactivity?.stop();
    this.proactivity = null;
  }

  /** Clears in-memory and persisted history. */
  async clearHistory(): Promise<void> {
    this.history = [];
    this.completedTurns = [];
    await this.context.workspaceState.update(HISTORY_STATE_KEY, []);
    this.post({ type: 'history-cleared' });
  }

  // ── Private ──

  private post(msg: HostToWebview): void {
    this.webview.postMessage(msg);
  }

  private restoreHistory(): void {
    const serialized =
      this.context.workspaceState.get<SerializedMessage[]>(HISTORY_STATE_KEY) ?? [];
    try {
      this.history = hydrate(serialized);
    } catch (err) {
      this.log(`[Chat] history hydrate failed, starting fresh: ${String(err)}`);
      this.history = [];
    }
  }

  private async persistHistory(): Promise<void> {
    const serialized = capToRecent(serialize(this.history));
    await this.context.workspaceState.update(HISTORY_STATE_KEY, serialized);
  }

  private async handleMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'webview-ready':
        this.ensureSubscribe();
        this.post({ type: 'history', turns: this.completedTurns });
        this.postContextSummary();
        break;
      case 'user-turn':
        await this.runTurn(msg.text);
        break;
      case 'cancel-turn':
        this.activeTurn?.abort();
        break;
      case 'accept-proactive-suggestion':
        // MVP: accepting a suggestion injects its text as a user turn.
        // The suggestion id is included so future work can correlate.
        this.log(`[Chat] proactive suggestion accepted: ${msg.id}`);
        break;
    }
  }

  /** Opens Subscribe stream + starts ProactivityWatcher. Idempotent. */
  private ensureSubscribe(): void {
    const transport = this.deps.getRpcClient();
    if (!transport || !transport.sessionId) return;
    if (this.subscribeHandler) return;

    const stream = transport.subscribeStream(transport.sessionId);
    this.subscribeHandler = stream;

    stream.on('data', (event: EngineEvent) => {
      if (event.state_updated?.view) {
        // convertCanvasView is host-internal; events come pre-converted via
        // LaceTransport? No — subscribeStream returns raw proto. We need to
        // convert here for parity with what tools/webview expect.
        this.latestView = convertRawCanvasView(event.state_updated.view);
        this.postContextSummary();
      }
    });
    stream.on('error', (err: Error) => {
      this.log(`[Chat] Subscribe error: ${err.message}`);
      this.subscribeHandler = null;
    });
    stream.on('end', () => {
      this.subscribeHandler = null;
    });

    this.proactivity = new ProactivityWatcher(
      transport,
      transport.sessionId,
      (suggestion) => this.post({ type: 'proactive-suggestion', suggestion }),
      this.log,
    );
    this.proactivity.start();
  }

  private postContextSummary(): void {
    const view = this.latestView;
    const transport = this.deps.getRpcClient();
    const summary: ContextSummary = {
      nodeCount: view?.nodes.length ?? 0,
      warningCount: 0,
      errorCount: view?.errors.length ?? 0,
      sessionId: transport?.sessionId ?? null,
    };
    this.post({ type: 'context-summary', summary });
  }

  private async ensureSession(): Promise<string | null> {
    const transport = this.deps.getRpcClient();
    if (!transport) return null;
    if (transport.sessionId) return transport.sessionId;

    const laceDir = this.deps.getLaceDir();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!laceDir || !workspaceFolder) return null;

    const { session_id } = await transport.sessionOpen({
      file_path: laceDir,
      workspace_name: workspaceFolder.name,
    });
    this.ensureSubscribe();
    return session_id;
  }

  private async runTurn(userText: string): Promise<void> {
    const transport = this.deps.getRpcClient();
    if (!transport) {
      this.post({ type: 'engine-unavailable' });
      return;
    }

    const [model] = await vscode.lm.selectChatModels({});
    if (!model) {
      this.post({ type: 'no-model' });
      return;
    }

    const sessionId = await this.ensureSession();
    if (!sessionId) {
      this.post({ type: 'engine-unavailable' });
      return;
    }

    this.activeTurn = new AbortController();
    const signal = this.activeTurn.signal;

    const session = startSession(userText);

    // Build message history: system prompt + persisted turns + current user message
    const systemPrompt = buildSystemPrompt([
      ...new Set(this.deps.getRegistryModules().map((m) => m.system)),
    ]);

    // Canvas snapshot — use latest view if available, else skip (LLM still gets tools)
    const canvasContext = this.latestView
      ? `Canvas: ${this.latestView.nodes.length} node(s), ${this.latestView.errors.length} error(s).`
      : 'Canvas: (state not yet loaded)';

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(systemPrompt),
      vscode.LanguageModelChatMessage.Assistant(
        'Understood. I am Lace, your Terraform infrastructure assistant.',
      ),
      ...this.history,
      vscode.LanguageModelChatMessage.User(`[Canvas state]\n${canvasContext}`),
      vscode.LanguageModelChatMessage.Assistant('Got it.'),
      vscode.LanguageModelChatMessage.User(userText),
    ];

    // Track tool-call failure repeats for stuck detection.
    const failSignatureCount = new Map<string, number>();

    // Accumulators for this turn's completed-turn record
    let assistantAccumulated = '';
    const turnToolCalls: CompletedTurn['toolCalls'] = [];
    const messageId = `msg-${Date.now()}`;

    // Start fresh: store the user message in history immediately so cancels preserve it
    this.history.push(vscode.LanguageModelChatMessage.User(userText));

    const tools = buildToolList();
    const cancellationToken = abortSignalToToken(signal);

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (signal.aborted) break;
        session.rounds = round + 1;

        let modelResponse: Awaited<ReturnType<typeof model.sendRequest>>;
        try {
          modelResponse = await model.sendRequest(messages, { tools }, cancellationToken);
        } catch (sendErr: unknown) {
          const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          this.log(`[Chat] model.sendRequest failed: ${msg}`);
          this.post({ type: 'token', text: `\n_Model request failed: ${msg}_` });
          assistantAccumulated += `\n_Model request failed: ${msg}_`;
          break;
        }

        const textParts: string[] = [];
        const toolCalls: Array<{ name: string; callId: string; input: Record<string, unknown> }> =
          [];

        for await (const part of modelResponse.stream) {
          if (signal.aborted) break;
          if (part instanceof vscode.LanguageModelTextPart) {
            textParts.push(part.value);
            assistantAccumulated += part.value;
            this.post({ type: 'token', text: part.value });
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push({
              name: part.name,
              callId: part.callId,
              input: part.input as Record<string, unknown>,
            });
          }
        }

        if (toolCalls.length === 0) break;

        const assistantContent: Array<
          vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart
        > = [
          ...textParts.map((t) => new vscode.LanguageModelTextPart(t)),
          ...toolCalls.map(
            (tc) => new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input),
          ),
        ];
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantContent));
        this.history.push(vscode.LanguageModelChatMessage.Assistant(assistantContent));

        const toolResultParts: vscode.LanguageModelToolResultPart[] = [];
        let allToolsErrored = true;

        for (const tc of toolCalls) {
          if (signal.aborted) break;

          this.post({ type: 'tool-call', callId: tc.callId, name: tc.name, input: tc.input });

          const handler = getToolHandler(tc.name);
          let result: ToolResult;
          const start = Date.now();

          if (!handler) {
            result = { content: `Unknown tool: ${tc.name}`, isError: true };
          } else {
            try {
              result = await handler(tc.input);
            } catch (err: unknown) {
              result = {
                content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
                isError: true,
              };
            }
          }

          const durationMs = Date.now() - start;
          logToolInvocation(session, tc.name, tc.input, result, durationMs);
          turnToolCalls.push({
            name: tc.name,
            input: tc.input,
            resultContent: result.content,
            isError: result.isError,
          });

          if (!result.isError) {
            allToolsErrored = false;
            failSignatureCount.delete(signatureFor(tc));
          } else {
            const sig = signatureFor(tc);
            failSignatureCount.set(sig, (failSignatureCount.get(sig) ?? 0) + 1);
          }

          this.post({
            type: 'tool-result',
            callId: tc.callId,
            name: tc.name,
            content: result.content,
            isError: result.isError,
          });

          toolResultParts.push(
            new vscode.LanguageModelToolResultPart(tc.callId, [
              new vscode.LanguageModelTextPart(
                result.isError ? `Tool [${tc.name}] failed: ${result.content}` : result.content,
              ),
            ]),
          );
        }

        messages.push(vscode.LanguageModelChatMessage.User(toolResultParts));
        this.history.push(vscode.LanguageModelChatMessage.User(toolResultParts));

        if (allToolsErrored && toolCalls.length > 0) {
          const errorDetails = toolResultParts
            .map((p) =>
              p.content
                .filter(
                  (c): c is vscode.LanguageModelTextPart =>
                    c instanceof vscode.LanguageModelTextPart,
                )
                .map((c) => c.value)
                .join(''),
            )
            .filter(Boolean);
          const msg = `\n_All tool calls failed:\n${errorDetails.map((e) => `- ${e}`).join('\n')}_`;
          this.post({ type: 'token', text: msg });
          assistantAccumulated += msg;
          break;
        }

        const stuck = [...failSignatureCount.entries()].find(([, count]) => count >= 2);
        if (stuck) {
          const msg = `\n_I'm stuck — required fields cannot be inferred. Please provide the missing values._`;
          this.post({ type: 'token', text: msg });
          assistantAccumulated += msg;
          break;
        }

        if (round === MAX_TOOL_ROUNDS - 1) {
          const msg = `\n_Reached operation limit (${MAX_TOOL_ROUNDS} rounds). Ask me to continue if needed._`;
          this.post({ type: 'token', text: msg });
          assistantAccumulated += msg;
        }
      }
    } finally {
      endSession(session, MAX_TOOL_ROUNDS);
      this.activeTurn = null;

      if (signal.aborted) {
        this.post({ type: 'turn-cancelled' });
      } else {
        this.completedTurns.push({
          messageId,
          userText,
          assistantText: assistantAccumulated,
          toolCalls: turnToolCalls,
        });
        // Cap completed turns in memory to match persisted cap.
        if (this.completedTurns.length > 50) {
          this.completedTurns = this.completedTurns.slice(-50);
        }
        await this.persistHistory();
        this.post({ type: 'turn-complete', messageId });
      }
    }
  }
}

// ── Helpers ──

function signatureFor(tc: { name: string; input: unknown }): string {
  return `${tc.name}:${JSON.stringify(tc.input)}`;
}

function buildToolList(): vscode.LanguageModelChatTool[] {
  // Private tools — build the chat tool list from the private registry,
  // not from vscode.lm.tools (public surface). The controller owns its tools.
  //
  // Each tool needs a name, description, and inputSchema. We reconstruct
  // these from the tool-registry + per-tool metadata that lives in package.json's
  // languageModelTools — except we just removed that. For the MVP, define
  // tools inline here.
  return TOOL_SCHEMAS;
}

/**
 * Tool schemas for the LLM — extracted from what was in package.json's
 * contributes.languageModelTools. Kept here because the tools are private
 * to the controller now.
 */
const TOOL_SCHEMAS: vscode.LanguageModelChatTool[] = [
  {
    name: 'lace_search_registry',
    description:
      'Search the Lace module registry for Terraform modules by keyword, cloud system, or category.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword' },
        system: { type: 'string', description: 'Cloud system: aws, azure, or gcp' },
        category: { type: 'string', description: 'Category filter' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'lace_describe_graph',
    description: 'Get the current canvas state.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lace_add_module',
    description: 'Add a Terraform module to the Lace canvas by name.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        system: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'lace_remove_module',
    description: 'Remove a module instance from the canvas by instance ID.',
    inputSchema: {
      type: 'object',
      properties: { instance_id: { type: 'string' } },
      required: ['instance_id'],
    },
  },
  {
    name: 'lace_connect',
    description: 'Wire an output from one instance to an input on another.',
    inputSchema: {
      type: 'object',
      properties: {
        source_instance: { type: 'string' },
        target_instance: { type: 'string' },
        source_output: { type: 'string' },
        target_input: { type: 'string' },
      },
      required: ['source_instance', 'target_instance', 'source_output', 'target_input'],
    },
  },
  {
    name: 'lace_disconnect',
    description: 'Remove a wire from an input.',
    inputSchema: {
      type: 'object',
      properties: { target_instance: { type: 'string' }, input_name: { type: 'string' } },
      required: ['target_instance', 'input_name'],
    },
  },
  {
    name: 'lace_set_input',
    description: 'Set the value of an input. Provide exactly one of: value, variable, expression.',
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'string' },
        input_name: { type: 'string' },
        value: {},
        variable: { type: 'string' },
        expression: { type: 'string' },
      },
      required: ['instance_id', 'input_name'],
    },
  },
  {
    name: 'lace_rename_instance',
    description: 'Rename a module instance.',
    inputSchema: {
      type: 'object',
      properties: { old_id: { type: 'string' }, new_id: { type: 'string' } },
      required: ['old_id', 'new_id'],
    },
  },
  {
    name: 'lace_inspect_module',
    description: 'Get input/output schema of a registry module.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        system: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'lace_validate_graph',
    description: 'Run graph validation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lace_workspace_context',
    description: "Read the user's project files to understand what they are building.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lace_auto_connect',
    description: 'Automatically wire compatible outputs between two instances.',
    inputSchema: {
      type: 'object',
      properties: {
        source_instance: { type: 'string' },
        target_instance: { type: 'string' },
      },
      required: ['source_instance', 'target_instance'],
    },
  },
  {
    name: 'lace_generate',
    description: 'Generate Terraform .tf files from the current canvas.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lace_inspect_node',
    description: 'Get live bindings of a placed instance.',
    inputSchema: {
      type: 'object',
      properties: { instance_id: { type: 'string' } },
      required: ['instance_id'],
    },
  },
  {
    name: 'lace_get_settings',
    description: 'Read canvas settings: terraform block, providers, locals, environments.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lace_set_variable',
    description: 'Add or update a canvas-level Terraform variable.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        required: { type: 'boolean' },
        description: { type: 'string' },
        default: {},
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'lace_undo',
    description: 'Undo the last change to the canvas.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lace_set_local',
    description: 'Add or update a Terraform local value.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: {},
        expression: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'lace_set_environment',
    description: 'Define environment-specific variable overrides.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: { type: 'string' },
        variables: { type: 'object' },
      },
      required: ['environment', 'variables'],
    },
  },
];

// ── AbortSignal → CancellationToken adapter ──
// The LM API expects a CancellationToken; we use AbortController internally.

function abortSignalToToken(signal: AbortSignal): vscode.CancellationToken {
  const emitter = new vscode.EventEmitter<void>();
  if (signal.aborted) {
    setTimeout(() => emitter.fire(), 0);
  } else {
    signal.addEventListener('abort', () => emitter.fire(), { once: true });
  }
  return {
    get isCancellationRequested() {
      return signal.aborted;
    },
    onCancellationRequested: emitter.event,
  };
}

// ── Raw proto CanvasView → render CanvasView ──
// Imported here because Subscribe stream returns raw proto types. We could
// use convertCanvasView from @lace/host but it's not exported. Re-import
// the exported one.

import { convertCanvasView } from '@lace/host';
function convertRawCanvasView(view: NonNullable<EngineEvent['state_updated']>['view']): CanvasView {
  return convertCanvasView(view as Parameters<typeof convertCanvasView>[0]);
}
