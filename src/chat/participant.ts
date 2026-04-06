// src/chat/participant.ts
//
// Chat participant registration + agentic tool loop.
// Integrates with VS Code's Chat Participant API and Language Model Tools API.

import * as vscode from 'vscode';

import type { LaceClient } from '../utilities/engine/grpc-client';
import type { RegistryModule } from '../types/protocol';
import type { CanvasView } from '../webview/types/render';

import { SYSTEM_PROMPT } from './system-prompt';
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
  getRpcClient: () => LaceClient | null;
  getRegistryModules: () => RegistryModule[];
  getLaceDir: () => string | undefined;
  getCanvasView?: () => CanvasView | undefined;
  publishCanvasView?: (state: CanvasView) => void;
};

// ── Max iterations for the agentic loop ──

const MAX_TOOL_ROUNDS = 15;

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

// ── Canvas state snapshot for injection into conversation ──

function buildCanvasContextMessage(canvasView: CanvasView | undefined): string {
  if (!canvasView) {
    return 'No canvas is open. Tell the user to open one with **Lace: Open Canvas** from the Command Palette before making any canvas changes.';
  }

  if (canvasView.nodes.length === 0) {
    return 'Canvas is open but empty — no modules added yet.';
  }

  const parts: string[] = [
    `Canvas snapshot: ${canvasView.nodes.length} instance(s), ${canvasView.edges.length} connection(s).`,
  ];

  const nodeList = canvasView.nodes
    .map((n) => `${n.id} (${n.label})${n.has_errors ? ' ⚠' : ''}`)
    .join(', ');
  parts.push(`Instances: ${nodeList}`);

  if (canvasView.edges.length > 0) {
    const edgeList = canvasView.edges
      .map((e) => `${e.source}.${e.source_output}→${e.target}.${e.target_input}`)
      .join(', ');
    parts.push(`Connections: ${edgeList}`);
  }

  if (canvasView.errors.length > 0) {
    parts.push(`Errors: ${canvasView.errors.length} validation error(s) present.`);
  }

  return parts.join('\n');
}

// ── Request handler factory — captures deps via closure ──

function makeHandleChatRequest(deps: ChatParticipantDeps) {
  return async function handleChatRequest(
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
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

    // Inject canvas state snapshot into conversation so model has ground truth instance IDs
    const canvasSnapshot = buildCanvasContextMessage(deps.getCanvasView?.());

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
      vscode.LanguageModelChatMessage.Assistant(
        'Understood. I am Lace, your Terraform infrastructure assistant. I will use the available tools to help you compose infrastructure on the canvas.',
      ),
      vscode.LanguageModelChatMessage.User(
        `Current canvas context:\n${canvasSnapshot}\n\nUser request: ${request.prompt}`,
      ),
    ];

    // Use the model from the chat request (whatever the user has selected)
    const model = request.model;

    // Agentic tool-use loop
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (token.isCancellationRequested) break;
        session.rounds = round + 1;

        const modelResponse = await model.sendRequest(
          messages,
          { tools: tools.map(toLanguageModelChatTool) },
          token,
        );

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
            toolResultParts.push(
              new vscode.LanguageModelToolResultPart(tc.callId, [
                new vscode.LanguageModelTextPart(`Tool [${tc.name}] failed: ${message}`),
              ]),
            );
          }
        }

        // Feed tool results back as a User message
        messages.push(vscode.LanguageModelChatMessage.User(toolResultParts));

        // Break if every tool in this round errored — avoid infinite retry loop
        if (allToolsErrored && toolCalls.length > 0) {
          response.markdown(
            '\n\n_All tool calls in this round failed. Cannot continue — check errors above._',
          );
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
