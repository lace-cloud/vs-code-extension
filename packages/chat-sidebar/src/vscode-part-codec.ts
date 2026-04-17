// Conversion between `vscode.LanguageModel*Part` and `@lace/chat-core`
// `Part` / message types.
//
// This is the single boundary between VS Code's concrete LM types and
// chat-core's IDE-agnostic types. Every other file in the adapter
// uses core types; this one translates at the vscode.lm seam.

import type { ChatMessage, ChatStreamEvent, Part, TextPart } from '@lace/chat-core';
import * as vscode from 'vscode';

// ── Core → VS Code ──

export function toVscodeMessage(msg: ChatMessage): vscode.LanguageModelChatMessage {
  const parts = msg.content.map(toVscodePart);
  // vscode.LanguageModelChatMessage.User / .Assistant both accept either
  // a string or an array of parts; the type declarations list `string`
  // narrowly but the runtime handles arrays. The cast is unavoidable
  // and long-established in the existing codebase.
  const content = parts as unknown as string;
  return msg.role === 'user'
    ? vscode.LanguageModelChatMessage.User(content)
    : vscode.LanguageModelChatMessage.Assistant(content);
}

function toVscodePart(
  part: Part,
):
  | vscode.LanguageModelTextPart
  | vscode.LanguageModelToolCallPart
  | vscode.LanguageModelToolResultPart {
  switch (part.kind) {
    case 'text':
      return new vscode.LanguageModelTextPart(part.value);
    case 'tool-call':
      // vscode's LanguageModelToolCallPart constructor types `input`
      // as `object`. Persisted inputs are always plain JSON values —
      // the cast is safe.
      return new vscode.LanguageModelToolCallPart(
        part.callId,
        part.name,
        (part.input ?? {}) as object,
      );
    case 'tool-result': {
      const inner = part.content.map((c) => new vscode.LanguageModelTextPart(c.value));
      return new vscode.LanguageModelToolResultPart(part.callId, inner);
    }
  }
}

// ── VS Code stream → Core stream events ──

export async function* vscodeStreamToEvents(
  stream: AsyncIterable<unknown>,
): AsyncIterable<ChatStreamEvent> {
  for await (const part of stream) {
    if (part instanceof vscode.LanguageModelTextPart) {
      yield { type: 'text', value: part.value };
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      yield {
        type: 'tool-call',
        callId: part.callId,
        name: part.name,
        input: part.input,
      };
    }
    // Any other part type is silently dropped — matches the pre-
    // refactor behaviour and keeps forward-compat if vscode adds new
    // part kinds we don't yet handle.
  }
}

// ── AbortSignal → vscode.CancellationToken ──
//
// Chat-core's adapter contract uses AbortSignal (web standard).
// `LanguageModelChat.sendRequest` requires `vscode.CancellationToken`.
// This adapter bridges them at the call site.

export function abortSignalToToken(signal: AbortSignal): vscode.CancellationToken {
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

// ── Text-part extraction for tests + history-restore ──
//
// Exposed so the restoration path can handle the pre-refactor
// `workspaceState` format if present. See vscode-adapter for the
// narrow use case.
export function vscodePartToCore(
  part:
    | vscode.LanguageModelTextPart
    | vscode.LanguageModelToolCallPart
    | vscode.LanguageModelToolResultPart,
): Part | null {
  if (part instanceof vscode.LanguageModelTextPart) {
    return { kind: 'text', value: part.value };
  }
  if (part instanceof vscode.LanguageModelToolCallPart) {
    return { kind: 'tool-call', callId: part.callId, name: part.name, input: part.input };
  }
  if (part instanceof vscode.LanguageModelToolResultPart) {
    const content = part.content
      .map((c): TextPart | null =>
        c instanceof vscode.LanguageModelTextPart ? { kind: 'text', value: c.value } : null,
      )
      .filter((c): c is TextPart => c !== null);
    return { kind: 'tool-result', callId: part.callId, content };
  }
  return null;
}
