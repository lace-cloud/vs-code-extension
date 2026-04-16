// src/chat/participant.ts
//
// Chat participant registration + agentic tool loop.
// Integrates with VS Code's Chat Participant API and Language Model Tools API.

import * as vscode from 'vscode';

import type { LaceTransport, RegistryModule, CanvasView } from './types';

import { buildSystemPrompt } from './system-prompt';
import { formatCanvasState } from './utils/canvas-summary';
import { getToolHandler, getRegisteredToolNames } from './tool-registry';
import { registerRegistryTools } from './tools/registry-tools';
import { registerGraphReadTools } from './tools/graph-read-tools';
import { registerGraphWriteTools } from './tools/graph-write-tools';
import { registerWorkspaceTools } from './tools/workspace-tools';
import { registerGenerateTools } from './tools/generate-tools';
import {
  startSession,
  endSession,
  logToolInvocation,
  logFeedback,
  type SessionMetadata,
} from './telemetry';

// ── Dependencies injected from extension.ts ──

export type ChatParticipantDeps = {
  getRpcClient: () => LaceTransport | null;
  getRegistryModules: () => RegistryModule[];
  getUserOrgs: () => Array<{ slug: string; name: string; role: string }>;
  getLaceDir: () => string | undefined;
  getCanvasView?: () => CanvasView | undefined;
  publishCanvasView?: (state: CanvasView) => void;
};

// ── Max iterations for the agentic loop ──

const MAX_TOOL_ROUNDS = 25;

// ── Chat result metadata key ──

const SESSION_META_KEY = 'lace_session';

// ── Registration ──

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  deps: ChatParticipantDeps,
): vscode.Disposable {
  // Register all tool handlers
  registerRegistryTools(deps);
  registerGraphReadTools(deps);
  registerGraphWriteTools(deps);
  registerWorkspaceTools();
  registerGenerateTools(deps);

  // Create the chat participant
  const participant = vscode.chat.createChatParticipant('lace.chat', makeHandleChatRequest(deps));
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'lace_logo.svg');

  // Feedback handler — correlate with session metadata
  participant.onDidReceiveFeedback((feedback) => {
    const meta = feedback.result.metadata?.[SESSION_META_KEY] as SessionMetadata | undefined;
    logFeedback(feedback.kind, meta);
  });

  return participant;
}

// ── Rebuild prior conversation history from VS Code ChatContext ──

function buildHistoryMessages(
  history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[],
): vscode.LanguageModelChatMessage[] {
  const result: vscode.LanguageModelChatMessage[] = [];
  for (const turn of history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      result.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const parts = (turn.response as vscode.ChatResponsePart[])
        .filter(
          (p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart,
        )
        .map((p) => p.value.value)
        .join('');
      if (parts) {
        result.push(vscode.LanguageModelChatMessage.Assistant(parts));
      }
    }
  }
  return result;
}

// ── Request handler factory — captures deps via closure ──

function makeHandleChatRequest(deps: ChatParticipantDeps) {
  return async function handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<vscode.ChatResult> {
    // ── Engine guard — fail fast if engine not running ──
    if (!deps.getRpcClient()) {
      response.markdown(
        'The Lace engine is not running. Start it with **Lace: Start Engine** from the Command Palette, then try again.',
      );
      return {};
    }

    // Start telemetry session
    const session = startSession(request.prompt, request.command);

    // Gather available tools — only tools with registered handlers (explicit whitelist)
    const registeredNames = new Set(getRegisteredToolNames());
    const tools = vscode.lm.tools.filter(
      (tool) => tool.name.startsWith('lace_') && registeredNames.has(tool.name),
    );

    // Inject canvas state snapshot — try in-memory view first, fall back to RPC
    let canvasSnapshot: string;
    const cachedView = deps.getCanvasView?.();
    if (cachedView) {
      canvasSnapshot = formatCanvasState(cachedView, { compact: true });
    } else {
      const client = deps.getRpcClient();
      if (client) {
        try {
          const summary = await client.queryGraphSummary();
          canvasSnapshot = summary.text;
        } catch {
          canvasSnapshot = formatCanvasState(undefined, { compact: true });
        }
      } else {
        canvasSnapshot = formatCanvasState(undefined, { compact: true });
      }
    }

    // Build messages: system prompt + prior conversation history + current turn
    // History is critical — without it "yes, add them all" has no context
    const historyMessages = buildHistoryMessages(
      context.history as readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[],
    );

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(
        buildSystemPrompt([...new Set(deps.getRegistryModules().map((m) => m.system))]),
      ),
      vscode.LanguageModelChatMessage.Assistant(
        'Understood. I am Lace, your Terraform infrastructure assistant. I will use the available tools to help you compose infrastructure on the canvas.',
      ),
      // Prior turns from this conversation thread
      ...historyMessages,
      // Canvas snapshot injected fresh just before each user message — this is the current state right now
      vscode.LanguageModelChatMessage.User(
        `[Current canvas state — refreshed for this message]\n${canvasSnapshot}`,
      ),
      vscode.LanguageModelChatMessage.Assistant('Understood, I have the current canvas state.'),
      // Current user message
      vscode.LanguageModelChatMessage.User(request.prompt),
    ];

    // Use the model from the chat request (whatever the user has selected)
    const model = request.model;

    // Agentic tool-use loop
    // Track consecutive identical failing tool calls to detect non-inferable field loops
    const failSignatureCount = new Map<string, number>();

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (token.isCancellationRequested) break;
        session.rounds = round + 1;

        let modelResponse: Awaited<ReturnType<typeof model.sendRequest>>;
        try {
          modelResponse = await model.sendRequest(
            messages,
            { tools: tools.map(toLanguageModelChatTool) },
            token,
          );
        } catch (sendErr: unknown) {
          const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          const isContextOverflow =
            msg.toLowerCase().includes('context') ||
            msg.toLowerCase().includes('token') ||
            msg.toLowerCase().includes('length');
          response.markdown(
            isContextOverflow
              ? '\n\n_The conversation has grown too long for the model to process. Start a new chat to continue._'
              : `\n\n_Model request failed: ${msg}_`,
          );
          break;
        }

        // Accumulate text and tool calls from the stream
        const textParts: string[] = [];
        const toolCalls: Array<{ name: string; callId: string; input: Record<string, unknown> }> =
          [];

        for await (const part of modelResponse.stream) {
          if (token.isCancellationRequested) break;
          if (part instanceof vscode.LanguageModelTextPart) {
            textParts.push(part.value);
            response.markdown(part.value);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            toolCalls.push({
              name: part.name,
              callId: part.callId,
              input: part.input as Record<string, unknown>,
            });
          }
        }

        // If no tool calls, we're done
        if (toolCalls.length === 0) {
          break;
        }

        // Build assistant message with text + tool calls
        const assistantContent: Array<
          vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart
        > = [
          ...textParts.map((t) => new vscode.LanguageModelTextPart(t)),
          ...toolCalls.map(
            (tc) => new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input),
          ),
        ];
        messages.push(vscode.LanguageModelChatMessage.Assistant(assistantContent));

        // Execute tool calls and collect results
        const toolResultParts: vscode.LanguageModelToolResultPart[] = [];
        let allToolsErrored = true;

        for (const tc of toolCalls) {
          if (token.isCancellationRequested) break;

          const handler = getToolHandler(tc.name);

          if (!handler) {
            const result = { content: `Unknown tool: ${tc.name}`, isError: true };
            logToolInvocation(session, tc.name, tc.input, result, 0);
            toolResultParts.push(
              new vscode.LanguageModelToolResultPart(tc.callId, [
                new vscode.LanguageModelTextPart(result.content),
              ]),
            );
            continue;
          }

          const start = Date.now();
          try {
            const result = await handler(tc.input);
            const durationMs = Date.now() - start;
            logToolInvocation(session, tc.name, tc.input, result, durationMs);

            if (!result.isError) {
              allToolsErrored = false;
              // Reset failure counter for this tool on success
              const sig = `${tc.name}:${JSON.stringify(tc.input)}`;
              failSignatureCount.delete(sig);
            } else {
              // Track consecutive identical failing calls (same tool + same input)
              const sig = `${tc.name}:${JSON.stringify(tc.input)}`;
              failSignatureCount.set(sig, (failSignatureCount.get(sig) ?? 0) + 1);
            }

            toolResultParts.push(
              new vscode.LanguageModelToolResultPart(tc.callId, [
                new vscode.LanguageModelTextPart(
                  result.isError ? `Tool [${tc.name}] failed: ${result.content}` : result.content,
                ),
              ]),
            );
          } catch (err: unknown) {
            const durationMs = Date.now() - start;
            const message = err instanceof Error ? err.message : String(err);
            const result = { content: `Tool error: ${message}`, isError: true };
            logToolInvocation(session, tc.name, tc.input, result, durationMs);
            const sig = `${tc.name}:${JSON.stringify(tc.input)}`;
            failSignatureCount.set(sig, (failSignatureCount.get(sig) ?? 0) + 1);
            toolResultParts.push(
              new vscode.LanguageModelToolResultPart(tc.callId, [
                new vscode.LanguageModelTextPart(`Tool [${tc.name}] failed: ${message}`),
              ]),
            );
          }
        }

        // Feed tool results back as a User message
        messages.push(vscode.LanguageModelChatMessage.User(toolResultParts));

        // Break if every tool in this round errored — show actual errors to user
        if (allToolsErrored && toolCalls.length > 0) {
          const errorDetails = toolResultParts
            .map((p) => {
              const text = p.content
                .filter(
                  (c): c is vscode.LanguageModelTextPart =>
                    c instanceof vscode.LanguageModelTextPart,
                )
                .map((c) => c.value)
                .join('');
              return text;
            })
            .filter(Boolean);
          const errorList =
            errorDetails.length > 0 ? '\n' + errorDetails.map((e) => `- ${e}`).join('\n') : '';
          response.markdown(`\n\n_All tool calls failed:${errorList}_`);
          break;
        }

        // Break if any tool has been called with identical args and failed 2+ times —
        // signals non-inferable required fields; prompt the user instead of looping
        const stuckEntry = [...failSignatureCount.entries()].find(([, count]) => count >= 2);
        if (stuckEntry) {
          const sig = stuckEntry[0];
          const colonIdx = sig.indexOf(':');
          const toolName = sig.slice(0, colonIdx);
          let guidance: string;
          try {
            const stuckParams = JSON.parse(sig.slice(colonIdx + 1));
            if (
              toolName === 'lace_set_input' &&
              stuckParams.instance_id &&
              stuckParams.input_name
            ) {
              guidance = `I cannot determine the value for "${stuckParams.input_name}" on instance "${stuckParams.instance_id}". Please provide this value.`;
            } else if (toolName === 'lace_connect') {
              guidance = `I cannot find a valid connection between "${stuckParams.source ?? '?'}" and "${stuckParams.target ?? '?'}". Please verify the output/input names.`;
            } else {
              guidance = `I'm stuck on "${toolName}". Please provide the missing information.`;
            }
          } catch {
            guidance =
              "I'm unable to proceed \u2014 one or more required fields cannot be inferred. Please provide the missing values.";
          }
          response.markdown(`\n\n_${guidance}_`);
          break;
        }

        // If MAX_TOOL_ROUNDS reached, summarize and stop
        if (round === MAX_TOOL_ROUNDS - 1) {
          const completed = session.toolCalls
            .filter((t) => !t.isError)
            .map((t) => t.name)
            .join(', ');
          response.markdown(
            `\n\n_Reached the operation limit (${MAX_TOOL_ROUNDS} rounds). Completed operations: ${completed || 'none'}. Ask me to continue if needed._`,
          );
        }
      }
    } finally {
      endSession(session, MAX_TOOL_ROUNDS);
    }

    // Return result with session metadata for feedback correlation
    return {
      metadata: {
        [SESSION_META_KEY]: session,
      },
    };
  };
}

// ── Helpers ──

function toLanguageModelChatTool(
  tool: vscode.LanguageModelToolInformation,
): vscode.LanguageModelChatTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  };
}
