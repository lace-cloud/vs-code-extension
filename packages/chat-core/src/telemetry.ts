// Structured telemetry for a chat session.
//
// Pure TS: session state is a plain object, formatting is deterministic,
// log output is routed through a caller-supplied `log(msg)` function
// (typically `ChatHostAdapter.log`). Nothing here imports vscode or
// requires a specific log sink — unit tests can pass a buffer-backed
// function and assert on the emitted lines.

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

export type Telemetry = {
  startSession(prompt: string, command?: string): SessionMetadata;
  logToolInvocation(
    session: SessionMetadata,
    name: string,
    params: unknown,
    result: { content: string; isError?: boolean },
    durationMs: number,
  ): void;
  endSession(session: SessionMetadata, maxToolRounds?: number): void;
};

const MAX_SESSIONS = 100;

export function createTelemetry(log: (message: string) => void): Telemetry {
  const sessionBuffer: SessionMetadata[] = [];
  let sessionCounter = 0;

  function recordSession(session: SessionMetadata): void {
    if (sessionBuffer.length >= MAX_SESSIONS) sessionBuffer.shift();
    sessionBuffer.push(session);
  }

  return {
    startSession(prompt, command) {
      sessionCounter += 1;
      const session: SessionMetadata = {
        sessionId: `s${sessionCounter}`,
        prompt,
        command,
        toolCalls: [],
        rounds: 0,
        startTime: Date.now(),
      };
      recordSession(session);

      log('');
      log(`[${ts()}] ── session ${session.sessionId} ──`);
      log(`  prompt: "${truncate(prompt, 120)}"`);
      if (command) log(`  command: /${command}`);
      return session;
    },

    logToolInvocation(session, name, params, result, durationMs) {
      const maxPreview = result.isError ? 500 : 200;
      const preview = truncate(result.content, maxPreview);
      session.toolCalls.push({
        name,
        params,
        durationMs,
        isError: result.isError ?? false,
        resultPreview: preview,
      });

      const status = result.isError ? 'ERR' : 'OK';
      log(`[${ts()}] [${session.sessionId}] tool ${name} (${durationMs}ms) ${status}`);
      log(`  params: ${JSON.stringify(params)}`);
      log(result.isError ? `  error: ${preview}` : `  result: ${preview}`);
    },

    endSession(session, maxToolRounds) {
      session.endTime = Date.now();
      const totalMs = session.endTime - session.startTime;
      const errorCount = session.toolCalls.filter((t) => t.isError).length;
      const toolNames = session.toolCalls.map((t) => t.name);

      const toolCounts: Record<string, number> = {};
      for (const name of toolNames) {
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
      }

      log(`[${ts()}] [${session.sessionId}] session end (${totalMs}ms)`);
      log(`  rounds: ${session.rounds}`);
      log(`  tools: ${session.toolCalls.length} call(s), ${errorCount} error(s)`);
      if (Object.keys(toolCounts).length > 0) {
        const breakdown = Object.entries(toolCounts)
          .map(([n, c]) => `${n}×${c}`)
          .join(', ');
        log(`  breakdown: ${breakdown}`);
      }

      if (maxToolRounds !== undefined && session.rounds >= maxToolRounds) {
        log(
          `  ⚠ session hit maxToolRounds (${maxToolRounds}) — possible stuck loop. Tool sequence: ${toolNames.join(' → ')}`,
        );
      }

      if (session.toolCalls.length === 0 && session.prompt.trim().length > 10) {
        log(`  ⚠ unmatched intent: no tools called for "${truncate(session.prompt, 100)}"`);
      }
    },
  };
}

function ts(): string {
  return new Date().toISOString();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}
