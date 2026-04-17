// VS Code implementation of ChatHostAdapter.
//
// Every call from chat-core's AgentController into the IDE lands
// here. The file is deliberately small: each method is a thin
// mapping onto a vscode.* API. Anything that would otherwise couple
// core to vscode types (LanguageModel*Part, CancellationToken,
// EventEmitter) is translated via `./vscode-part-codec`.

import type {
  ChatHostAdapter,
  ChatMessage,
  ChatModel,
  ChatStreamEvent,
  ToolSchema,
} from '@lace/chat-core';
import * as vscode from 'vscode';
import { abortSignalToToken, toVscodeMessage, vscodeStreamToEvents } from './vscode-part-codec';

const CONFIG_NAMESPACE = 'lace';
const CONFIG_SUBTREE = 'chat';

type OpaqueVscodeModel = ChatModel & { __vscode: vscode.LanguageModelChat };

function brand(model: vscode.LanguageModelChat): OpaqueVscodeModel {
  return model as unknown as OpaqueVscodeModel;
}

function unbrand(model: ChatModel): vscode.LanguageModelChat {
  return (model as OpaqueVscodeModel).__vscode ?? (model as unknown as vscode.LanguageModelChat);
}

export type VsCodeChatAdapterOptions = {
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
};

export function createVsCodeChatAdapter(opts: VsCodeChatAdapterOptions): ChatHostAdapter {
  const { context, outputChannel } = opts;

  return {
    async selectModel() {
      const [model] = await vscode.lm.selectChatModels({});
      return model ? brand(model) : null;
    },

    async *sendRequest(
      model: ChatModel,
      messages: ChatMessage[],
      tools: ToolSchema[],
      signal: AbortSignal,
    ): AsyncIterable<ChatStreamEvent> {
      const vscodeModel = unbrand(model);
      const vscodeMessages = messages.map(toVscodeMessage);
      const cancellationToken = abortSignalToToken(signal);
      const response = await vscodeModel.sendRequest(vscodeMessages, { tools }, cancellationToken);
      yield* vscodeStreamToEvents(response.stream);
    },

    async saveHistory(key: string, messages: ChatMessage[]) {
      await context.workspaceState.update(key, messages);
    },

    async loadHistory(key: string) {
      const stored = context.workspaceState.get<ChatMessage[]>(key);
      return stored ?? null;
    },

    getConfig<T>(key: string, defaultValue: T): T {
      // Config keys in core are subtree-local (e.g. `'proactivity'`);
      // they map onto `lace.chat.<key>` in VS Code settings.
      return vscode.workspace
        .getConfiguration(`${CONFIG_NAMESPACE}.${CONFIG_SUBTREE}`)
        .get<T>(key, defaultValue);
    },

    getWorkspaceName() {
      return vscode.workspace.workspaceFolders?.[0]?.name ?? null;
    },

    log(message: string) {
      outputChannel.appendLine(message);
    },
  };
}
