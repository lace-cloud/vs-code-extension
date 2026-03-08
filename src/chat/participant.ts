// src/chat/participant.ts
//
// Chat participant registration + agentic tool loop.
// Integrates with VS Code's Chat Participant API and Language Model Tools API.

import * as vscode from 'vscode';

import type { JSONRPCClient } from '../utilities/engine/rpc-client';
import type { RegistryModule } from '../types/protocol';
import type { WorkspaceState } from '../webview/types/workspace';
import type { Bundle } from '../webview/types/ir';
import type { WorkspaceAction } from '../webview/state/reducer';

import { SYSTEM_PROMPT } from './system-prompt';
import { getToolHandler } from './tool-registry';
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
  getRpcClient: () => JSONRPCClient | null;
  getRegistryModules: () => RegistryModule[];
  addModuleToActiveCanvas: (deploy_bundle: Bundle, icon_url?: string) => void;
  requestGraphState: () => Promise<WorkspaceState>;
  dispatchToCanvas: (action: WorkspaceAction) => Promise<void>;
  triggerGenerate: () => void;
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
  const participant = vscode.chat.createChatParticipant('lace.chat', handleChatRequest);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'lace_logo.svg');

  // Feedback handler — correlate with session metadata
  participant.onDidReceiveFeedback((feedback) => {
    const meta = feedback.result.metadata?.[SESSION_META_KEY] as SessionMetadata | undefined;
    logFeedback(feedback.kind, meta);
  });

  return participant;
}

// ── Request handler ──

async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  response: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  // Start telemetry session
  const session = startSession(request.prompt, request.command);

  // Gather available tools (only lace_ tools)
  const tools = vscode.lm.tools.filter((tool) => tool.name.startsWith('lace_'));

  // Build initial messages — system prompt as first User message, then the actual prompt.
  // VS Code chat API has no System role, so we prepend instructions.
  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
    vscode.LanguageModelChatMessage.Assistant(
      'Understood. I will use the available tools to help you compose Terraform infrastructure. What would you like to do?',
    ),
    vscode.LanguageModelChatMessage.User(request.prompt),
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
      const toolCalls: Array<{ name: string; callId: string; input: Record<string, unknown> }> = [];

      for await (const part of modelResponse.stream) {
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
          (tc) => new vscode.LanguageModelToolCallPart(tc.name, tc.callId, tc.input),
        ),
      ];
      messages.push(vscode.LanguageModelChatMessage.Assistant(assistantContent));

      // Execute tool calls and collect results
      const toolResultParts: vscode.LanguageModelToolResultPart[] = [];

      for (const tc of toolCalls) {
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
          toolResultParts.push(
            new vscode.LanguageModelToolResultPart(tc.callId, [
              new vscode.LanguageModelTextPart(result.content),
            ]),
          );
        } catch (err: any) {
          const durationMs = Date.now() - start;
          const result = { content: `Tool error: ${err.message}`, isError: true };
          logToolInvocation(session, tc.name, tc.input, result, durationMs);
          toolResultParts.push(
            new vscode.LanguageModelToolResultPart(tc.callId, [
              new vscode.LanguageModelTextPart(result.content),
            ]),
          );
        }
      }

      // Feed tool results back as a User message
      messages.push(vscode.LanguageModelChatMessage.User(toolResultParts));
    }
  } finally {
    endSession(session);
  }

  // Return result with session metadata for feedback correlation
  return {
    metadata: {
      [SESSION_META_KEY]: session,
    },
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
