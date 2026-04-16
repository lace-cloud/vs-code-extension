import * as vscode from 'vscode';
import { status as GrpcStatus, type ServiceError } from '@grpc/grpc-js';

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

function isGrpcServiceError(err: unknown): err is ServiceError {
  return (
    err instanceof Error &&
    typeof (err as ServiceError).code === 'number' &&
    typeof (err as ServiceError).details === 'string'
  );
}

export function classifyRpcError(err: unknown, method: string): RpcError {
  if (isGrpcServiceError(err)) {
    const msg = err.details || err.message;
    switch (err.code) {
      case GrpcStatus.UNAVAILABLE:
      case GrpcStatus.CANCELLED:
        return new RpcError(msg, 'engine_unavailable', method, err);
      case GrpcStatus.DEADLINE_EXCEEDED:
        return new RpcError(msg, 'timeout', method, err);
      default:
        return new RpcError(msg, 'server_error', method, err);
    }
  }

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

  console.error(`[RPC] ${method} failed:`, classified.cause ?? classified.message);

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
