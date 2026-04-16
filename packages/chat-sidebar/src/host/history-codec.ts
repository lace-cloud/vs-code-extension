import * as vscode from 'vscode';

// ── Serialized shapes (plain JSON — safe for workspaceState) ──

export type SerializedPart =
  | { kind: 'text'; value: string }
  | { kind: 'tool-call'; callId: string; name: string; input: unknown }
  | { kind: 'tool-result'; callId: string; content: SerializedPart[]; isError?: boolean };

export type SerializedMessage = {
  role: 'user' | 'assistant';
  content: SerializedPart[];
};

const HISTORY_CAP_TURNS = 50;

// ── Serialize: LanguageModelChatMessage[] → plain JSON ──

function serializePart(
  part:
    | vscode.LanguageModelTextPart
    | vscode.LanguageModelToolCallPart
    | vscode.LanguageModelToolResultPart,
): SerializedPart | null {
  if (part instanceof vscode.LanguageModelTextPart) {
    return { kind: 'text', value: part.value };
  }
  if (part instanceof vscode.LanguageModelToolCallPart) {
    return { kind: 'tool-call', callId: part.callId, name: part.name, input: part.input };
  }
  if (part instanceof vscode.LanguageModelToolResultPart) {
    const nested = part.content
      .map((p) =>
        p instanceof vscode.LanguageModelTextPart
          ? ({ kind: 'text', value: p.value } as const)
          : null,
      )
      .filter((p): p is { kind: 'text'; value: string } => p !== null);
    return { kind: 'tool-result', callId: part.callId, content: nested };
  }
  // Unknown part kind — forward-compat: drop silently
  console.warn('[history-codec] Unknown part kind, dropping:', part);
  return null;
}

export function serialize(messages: vscode.LanguageModelChatMessage[]): SerializedMessage[] {
  const result: SerializedMessage[] = [];
  for (const msg of messages) {
    const role: 'user' | 'assistant' =
      msg.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
    const content = (
      msg.content as unknown as Array<
        | vscode.LanguageModelTextPart
        | vscode.LanguageModelToolCallPart
        | vscode.LanguageModelToolResultPart
      >
    )
      .map(serializePart)
      .filter((p): p is SerializedPart => p !== null);
    result.push({ role, content });
  }
  return result;
}

// ── Hydrate: plain JSON → LanguageModelChatMessage[] ──

function hydratePart(
  part: SerializedPart,
):
  | vscode.LanguageModelTextPart
  | vscode.LanguageModelToolCallPart
  | vscode.LanguageModelToolResultPart
  | null {
  if (part.kind === 'text') {
    return new vscode.LanguageModelTextPart(part.value);
  }
  if (part.kind === 'tool-call') {
    // The vscode constructor types input as `object`. Persisted inputs are
    // JSON (always an object or primitive) — narrow here to satisfy the type.
    const input = (part.input ?? {}) as object;
    return new vscode.LanguageModelToolCallPart(part.callId, part.name, input);
  }
  if (part.kind === 'tool-result') {
    const inner = part.content
      .map((p) => (p.kind === 'text' ? new vscode.LanguageModelTextPart(p.value) : null))
      .filter((p): p is vscode.LanguageModelTextPart => p !== null);
    return new vscode.LanguageModelToolResultPart(part.callId, inner);
  }
  return null;
}

export function hydrate(serialized: SerializedMessage[]): vscode.LanguageModelChatMessage[] {
  const result: vscode.LanguageModelChatMessage[] = [];
  for (const msg of serialized) {
    const parts = msg.content
      .map(hydratePart)
      .filter(
        (
          p,
        ): p is
          | vscode.LanguageModelTextPart
          | vscode.LanguageModelToolCallPart
          | vscode.LanguageModelToolResultPart => p !== null,
      );
    if (parts.length === 0) continue;
    if (msg.role === 'user') {
      // User messages use vscode.LanguageModelChatMessage.User which accepts
      // either string or Array<...>.
      result.push(vscode.LanguageModelChatMessage.User(parts as unknown as string));
    } else {
      result.push(vscode.LanguageModelChatMessage.Assistant(parts as unknown as string));
    }
  }
  return result;
}

// ── Cap ──

export function capToRecent(messages: SerializedMessage[]): SerializedMessage[] {
  // Cap at HISTORY_CAP_TURNS — a "turn" is a user message + assistant response,
  // so keep last HISTORY_CAP_TURNS * 2 messages.
  const limit = HISTORY_CAP_TURNS * 2;
  if (messages.length <= limit) return messages;
  return messages.slice(messages.length - limit);
}
