// src/chat/telemetry.ts
//
// Structured telemetry for the Lace chat participant.
// Logs to a VS Code output channel with session tracking, timing, and
// feedback correlation.

import * as vscode from 'vscode';

/* ---------------------------------- */
/* Output channel                     */
/* ---------------------------------- */

let channel: vscode.OutputChannel | undefined;

function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Lace Chat');
  }
  return channel;
}

function ts(): string {
  return new Date().toISOString();
}

/* ---------------------------------- */
/* Session tracking                   */
/* ---------------------------------- */

export type ToolInvocationRecord = {
  name: string;
  params: unknown;
  durationMs: number;
  isError: boolean;
  resultPreview: string;
};

export type SessionMetadata = {
  sessionId: string;
  prompt: string;
  command?: string;
  toolCalls: ToolInvocationRecord[];
  rounds: number;
  startTime: number;
  endTime?: number;
};

// Circular buffer — keep only last 100 sessions to avoid memory leak
const MAX_SESSIONS = 100;
const sessionBuffer: SessionMetadata[] = [];
let sessionCounter = 0;

/**
 * Start a new telemetry session for a chat request.
 * Returns a SessionMetadata object that should be mutated during the
 * request and passed to endSession() when done.
 */
export function startSession(prompt: string, command?: string): SessionMetadata {
  sessionCounter++;
  const session: SessionMetadata = {
    sessionId: `s${sessionCounter}`,
    prompt,
    command,
    toolCalls: [],
    rounds: 0,
    startTime: Date.now(),
  };

  // Circular buffer eviction
  if (sessionBuffer.length >= MAX_SESSIONS) {
    sessionBuffer.shift();
  }
  sessionBuffer.push(session);

  const ch = getChannel();
  ch.appendLine('');
  ch.appendLine(`[${ts()}] ── session ${session.sessionId} ──`);
  ch.appendLine(`  prompt: "${truncate(prompt, 120)}"`);
  if (command) ch.appendLine(`  command: /${command}`);

  return session;
}

/**
 * Log a tool invocation with timing. Call this after the tool handler returns.
 * Mutates session.toolCalls.
 */
export function logToolInvocation(
  session: SessionMetadata,
  name: string,
  params: unknown,
  result: { content: string; isError?: boolean },
  durationMs: number,
): void {
  // Use longer truncation for errors so diagnostics are readable
  const maxPreview = result.isError ? 500 : 200;
  const preview = truncate(result.content, maxPreview);
  const record: ToolInvocationRecord = {
    name,
    params,
    durationMs,
    isError: result.isError ?? false,
    resultPreview: preview,
  };
  session.toolCalls.push(record);

  const ch = getChannel();
  const status = result.isError ? 'ERR' : 'OK';
  ch.appendLine(`[${ts()}] [${session.sessionId}] tool ${name} (${durationMs}ms) ${status}`);
  ch.appendLine(`  params: ${JSON.stringify(params)}`);
  if (result.isError) {
    ch.appendLine(`  error: ${preview}`);
  } else {
    ch.appendLine(`  result: ${preview}`);
  }
}

/**
 * End a session and log a summary.
 */
export function endSession(session: SessionMetadata, maxToolRounds?: number): void {
  session.endTime = Date.now();
  const totalMs = session.endTime - session.startTime;

  const ch = getChannel();
  const errorCount = session.toolCalls.filter((t) => t.isError).length;
  const toolNames = session.toolCalls.map((t) => t.name);

  // Count tool usage
  const toolCounts: Record<string, number> = {};
  for (const name of toolNames) {
    toolCounts[name] = (toolCounts[name] ?? 0) + 1;
  }

  ch.appendLine(`[${ts()}] [${session.sessionId}] session end (${totalMs}ms)`);
  ch.appendLine(`  rounds: ${session.rounds}`);
  ch.appendLine(`  tools: ${session.toolCalls.length} call(s), ${errorCount} error(s)`);
  if (Object.keys(toolCounts).length > 0) {
    const breakdown = Object.entries(toolCounts)
      .map(([n, c]) => `${n}×${c}`)
      .join(', ');
    ch.appendLine(`  breakdown: ${breakdown}`);
  }

  // Detect stuck loop: hit max rounds
  if (maxToolRounds !== undefined && session.rounds >= maxToolRounds) {
    ch.appendLine(
      `  ⚠ session hit MAX_TOOL_ROUNDS (${maxToolRounds}) — possible stuck loop. Tool sequence: ${toolNames.join(' → ')}`,
    );
  }

  // Detect unmatched intent: non-trivial prompt but no tools were called
  if (session.toolCalls.length === 0 && session.prompt.trim().length > 10) {
    ch.appendLine(`  ⚠ unmatched intent: no tools called for "${truncate(session.prompt, 100)}"`);
  }
}

/**
 * Log feedback (thumbs up/down) with session metadata for correlation.
 */
export function logFeedback(kind: vscode.ChatResultFeedbackKind, metadata?: SessionMetadata): void {
  const ch = getChannel();
  const label = kind === vscode.ChatResultFeedbackKind.Helpful ? '👍 helpful' : '👎 unhelpful';

  ch.appendLine('');
  ch.appendLine(`[${ts()}] [feedback] ${label}`);

  if (metadata) {
    ch.appendLine(`  session: ${metadata.sessionId}`);
    ch.appendLine(`  prompt: "${truncate(metadata.prompt, 100)}"`);
    if (metadata.command) ch.appendLine(`  command: /${metadata.command}`);
    ch.appendLine(`  tools: ${metadata.toolCalls.length} call(s)`);
    if (metadata.toolCalls.length > 0) {
      const toolNames = metadata.toolCalls.map((t) => {
        const status = t.isError ? '✗' : '✓';
        return `${status} ${t.name}`;
      });
      ch.appendLine(`  sequence: ${toolNames.join(' → ')}`);
    }
    const totalMs = (metadata.endTime ?? Date.now()) - metadata.startTime;
    ch.appendLine(`  duration: ${totalMs}ms`);
  }
}

/* ---------------------------------- */
/* Helpers                            */
/* ---------------------------------- */

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
