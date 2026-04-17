// Agentic loop, IDE-agnostic.
//
// Owns: message history, completed-turn log, in-flight cancellation,
// the send→stream→tool-call→tool-result→repeat cycle, and the
// stuck/limit/error handlers that prevent runaway loops. Everything
// IDE-specific is reached through the injected `ChatHostAdapter`,
// `WebviewTransport`, and `ToolRegistry` — each of which has a
// single well-defined shape defined elsewhere in this package.
//
// `runTurn` is the only non-trivial method. It's intentionally long
// and linear: the agentic loop's control flow (break on no-tools,
// break on stuck, break on all-errored, continue otherwise) is
// easiest to read top-to-bottom without fragmenting into helpers
// that would be called from exactly one place. Accumulated state
// lives in clearly-scoped locals; the only things mutated outside
// the function scope are `this.history`, `this.completedTurns`, and
// the transport.

import type { CanvasView } from '@lace/host';
import { capRecentMessages } from './history';
import type { ChatHostAdapter } from './host-adapter';
import type { CompletedTurn, ContextSummary, ProactiveSuggestion, WebviewToHost } from './protocol';
import { createTelemetry, type Telemetry } from './telemetry';
import type { ToolRegistry } from './tool-registry';
import type {
  ChatMessage,
  Disposable,
  Part,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from './types';
import type { WebviewTransport } from './webview-transport';

export type AgentControllerOptions = {
  adapter: ChatHostAdapter;
  transport: WebviewTransport;
  toolRegistry: ToolRegistry;
  buildSystemPrompt: (availableSystems: string[]) => string;
  getAvailableSystems: () => string[];
  getCanvasView: () => CanvasView | null;
  historyKey: string;
  maxToolRounds?: number;
  completedTurnCap?: number;
};

const DEFAULT_MAX_TOOL_ROUNDS = 25;
const DEFAULT_COMPLETED_TURN_CAP = 50;

export class AgentController {
  private history: ChatMessage[] = [];
  private completedTurns: CompletedTurn[] = [];
  private activeTurn: AbortController | null = null;
  private transportSubscription: Disposable | null = null;
  private readonly telemetry: Telemetry;

  constructor(private readonly opts: AgentControllerOptions) {
    this.telemetry = createTelemetry((msg) => opts.adapter.log(msg));
  }

  /** Load persisted history and start listening for webview messages. */
  async init(): Promise<void> {
    try {
      this.history = (await this.opts.adapter.loadHistory(this.opts.historyKey)) ?? [];
    } catch (err) {
      this.opts.adapter.log(`[Chat] history load failed, starting fresh: ${String(err)}`);
      this.history = [];
    }
    this.transportSubscription = this.opts.transport.onMessage((msg) =>
      this.handleWebviewMessage(msg),
    );
  }

  /** Cancel any active turn and unsubscribe from the webview. */
  dispose(): void {
    this.activeTurn?.abort();
    this.activeTurn = null;
    this.transportSubscription?.dispose();
    this.transportSubscription = null;
  }

  /** Drop in-memory and persisted history. */
  async clearHistory(): Promise<void> {
    this.history = [];
    this.completedTurns = [];
    await this.opts.adapter.saveHistory(this.opts.historyKey, []);
    this.opts.transport.postMessage({ type: 'history-cleared' });
  }

  /** Push a context-summary banner into the chat UI. */
  postContextSummary(summary: ContextSummary): void {
    this.opts.transport.postMessage({ type: 'context-summary', summary });
  }

  /** Forward a proactive suggestion from the watcher to the chat UI. */
  postProactiveSuggestion(suggestion: ProactiveSuggestion): void {
    this.opts.transport.postMessage({ type: 'proactive-suggestion', suggestion });
  }

  /** Notify the chat UI that the engine is unavailable for this session. */
  postEngineUnavailable(): void {
    this.opts.transport.postMessage({ type: 'engine-unavailable' });
  }

  private async handleWebviewMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'webview-ready':
        this.opts.transport.postMessage({ type: 'history', turns: this.completedTurns });
        break;
      case 'user-turn':
        await this.runTurn(msg.text);
        break;
      case 'cancel-turn':
        this.activeTurn?.abort();
        break;
      case 'accept-proactive-suggestion':
        this.opts.adapter.log(`[Chat] proactive suggestion accepted: ${msg.id}`);
        break;
    }
  }

  private async runTurn(userText: string): Promise<void> {
    const model = await this.opts.adapter.selectModel();
    if (!model) {
      this.opts.transport.postMessage({ type: 'no-model' });
      return;
    }

    this.activeTurn = new AbortController();
    const signal = this.activeTurn.signal;
    const session = this.telemetry.startSession(userText);

    const systemPrompt = this.opts.buildSystemPrompt(this.opts.getAvailableSystems());
    const canvasView = this.opts.getCanvasView();
    const canvasContext = canvasView
      ? `Canvas: ${canvasView.nodes.length} node(s), ${canvasView.errors.length} error(s).`
      : 'Canvas: (state not yet loaded)';

    const messages: ChatMessage[] = [
      { role: 'user', content: [{ kind: 'text', value: systemPrompt }] },
      {
        role: 'assistant',
        content: [
          {
            kind: 'text',
            value: 'Understood. I am Lace, your Terraform infrastructure assistant.',
          },
        ],
      },
      ...this.history,
      { role: 'user', content: [{ kind: 'text', value: `[Canvas state]\n${canvasContext}` }] },
      { role: 'assistant', content: [{ kind: 'text', value: 'Got it.' }] },
      { role: 'user', content: [{ kind: 'text', value: userText }] },
    ];

    // Persist the user message in history right away so a cancel
    // preserves it rather than losing the turn outright.
    this.history.push({ role: 'user', content: [{ kind: 'text', value: userText }] });

    const turnToolCalls: CompletedTurn['toolCalls'] = [];
    let assistantAccumulated = '';
    const messageId = `msg-${Date.now()}`;
    const failSignatureCount = new Map<string, number>();
    const tools = this.opts.toolRegistry.listSchemas();
    const maxRounds = this.opts.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

    try {
      for (let round = 0; round < maxRounds; round++) {
        if (signal.aborted) break;
        session.rounds = round + 1;

        const textParts: string[] = [];
        const toolCalls: Array<{ name: string; callId: string; input: Record<string, unknown> }> =
          [];

        try {
          for await (const event of this.opts.adapter.sendRequest(model, messages, tools, signal)) {
            if (signal.aborted) break;
            if (event.type === 'text') {
              textParts.push(event.value);
              assistantAccumulated += event.value;
              this.opts.transport.postMessage({ type: 'token', text: event.value });
            } else if (event.type === 'tool-call') {
              toolCalls.push({
                name: event.name,
                callId: event.callId,
                input: event.input as Record<string, unknown>,
              });
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.opts.adapter.log(`[Chat] sendRequest failed: ${msg}`);
          const line = `\n_Model request failed: ${msg}_`;
          this.opts.transport.postMessage({ type: 'token', text: line });
          assistantAccumulated += line;
          break;
        }

        if (toolCalls.length === 0) break;

        const assistantContent: Part[] = [
          ...textParts.map((t): TextPart => ({ kind: 'text', value: t })),
          ...toolCalls.map(
            (tc): ToolCallPart => ({
              kind: 'tool-call',
              callId: tc.callId,
              name: tc.name,
              input: tc.input,
            }),
          ),
        ];
        messages.push({ role: 'assistant', content: assistantContent });
        this.history.push({ role: 'assistant', content: assistantContent });

        const toolResultParts: ToolResultPart[] = [];
        let allToolsErrored = true;

        for (const tc of toolCalls) {
          if (signal.aborted) break;

          this.opts.transport.postMessage({
            type: 'tool-call',
            callId: tc.callId,
            name: tc.name,
            input: tc.input,
          });

          const handler = this.opts.toolRegistry.getHandler(tc.name);
          const startedAt = Date.now();
          let result: { content: string; isError?: boolean };
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
          const durationMs = Date.now() - startedAt;
          this.telemetry.logToolInvocation(session, tc.name, tc.input, result, durationMs);

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

          this.opts.transport.postMessage({
            type: 'tool-result',
            callId: tc.callId,
            name: tc.name,
            content: result.content,
            isError: result.isError,
          });

          toolResultParts.push({
            kind: 'tool-result',
            callId: tc.callId,
            content: [
              {
                kind: 'text',
                value: result.isError
                  ? `Tool [${tc.name}] failed: ${result.content}`
                  : result.content,
              },
            ],
            isError: result.isError,
          });
        }

        messages.push({ role: 'user', content: toolResultParts });
        this.history.push({ role: 'user', content: toolResultParts });

        if (allToolsErrored && toolCalls.length > 0) {
          const errorDetails = toolResultParts
            .flatMap((p) => p.content.map((c) => c.value))
            .filter(Boolean);
          const msg = `\n_All tool calls failed:\n${errorDetails.map((e) => `- ${e}`).join('\n')}_`;
          this.opts.transport.postMessage({ type: 'token', text: msg });
          assistantAccumulated += msg;
          break;
        }

        const stuck = [...failSignatureCount.entries()].find(([, count]) => count >= 2);
        if (stuck) {
          const msg = `\n_I'm stuck — required fields cannot be inferred. Please provide the missing values._`;
          this.opts.transport.postMessage({ type: 'token', text: msg });
          assistantAccumulated += msg;
          break;
        }

        if (round === maxRounds - 1) {
          const msg = `\n_Reached operation limit (${maxRounds} rounds). Ask me to continue if needed._`;
          this.opts.transport.postMessage({ type: 'token', text: msg });
          assistantAccumulated += msg;
        }
      }
    } finally {
      this.telemetry.endSession(session, maxRounds);
      this.activeTurn = null;

      if (signal.aborted) {
        this.opts.transport.postMessage({ type: 'turn-cancelled' });
      } else {
        this.completedTurns.push({
          messageId,
          userText,
          assistantText: assistantAccumulated,
          toolCalls: turnToolCalls,
        });
        const cap = this.opts.completedTurnCap ?? DEFAULT_COMPLETED_TURN_CAP;
        if (this.completedTurns.length > cap) {
          this.completedTurns = this.completedTurns.slice(-cap);
        }
        await this.opts.adapter.saveHistory(this.opts.historyKey, capRecentMessages(this.history));
        this.opts.transport.postMessage({ type: 'turn-complete', messageId });
      }
    }
  }
}

function signatureFor(tc: { name: string; input: unknown }): string {
  return `${tc.name}:${JSON.stringify(tc.input)}`;
}
