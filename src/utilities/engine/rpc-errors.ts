import * as vscode from 'vscode';

// ── Error categories ──

export type RpcErrorCategory = 'engine_unavailable' | 'server_error' | 'timeout';

// ── RpcError ──

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly category: RpcErrorCategory,
    public readonly method: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

// ── Classification ──

export function classifyRpcError(err: unknown, method: string): RpcError {
  const msg = err instanceof Error ? err.message : String(err);

  if (/timeout/i.test(msg)) {
    return new RpcError(msg, 'timeout', method, err);
  }

  if (/disposed|EPIPE|ECONNRESET|ECONNREFUSED|not available|not initialized/i.test(msg)) {
    return new RpcError(msg, 'engine_unavailable', method, err);
  }

  return new RpcError(msg, 'server_error', method, err);
}

// ── Policy application ──

export function handleRpcError(err: unknown, method: string, context: string): RpcError {
  const classified = err instanceof RpcError ? err : classifyRpcError(err, method);

  // Always log the full error
  console.error(`[RPC] ${method} failed:`, classified.cause ?? classified.message);

  // User-facing message based on category
  switch (classified.category) {
    case 'engine_unavailable':
    case 'timeout':
      vscode.window.showErrorMessage(
        'Lace engine is not available. Start it with "Lace: Start Engine".',
      );
      break;
    case 'server_error':
      vscode.window.showErrorMessage(`Failed to ${context}: ${classified.message}`);
      break;
  }

  return classified;
}

// ── Guard: require non-null client ──

export function requireClient<T>(client: T | null | undefined, action: string): T {
  if (!client) {
    throw new RpcError('Lace engine is not available', 'engine_unavailable', action);
  }
  return client;
}
