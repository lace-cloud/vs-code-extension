import type { CanvasView, EngineEvent, LaceTransport } from '@lace/host';
import * as vscode from 'vscode';
import type { CompletedTurn, ContextSummary, HostToWebview, WebviewToHost } from '../protocol';
import { capToRecent, hydrate, type SerializedMessage, serialize } from './history-codec';
import { ProactivityWatcher } from './proactivity';
import { buildSystemPrompt } from './system-prompt';
import { endSession, logToolInvocation, startSession } from './telemetry';
import { getToolHandler, getToolSchemas } from './tool-registry';
import type { ToolDeps, ToolResult } from './types';

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
    if (!transport?.sessionId) return;
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

    const tools = getToolSchemas();
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
