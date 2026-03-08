// src/chat/tools/helpers.ts
//
// Shared helpers for chat tool implementations.

import type { JSONRPCClient } from '../../utilities/engine/rpc-client';
import type { ToolResult } from '../types';

const ENGINE_NOT_RUNNING: ToolResult = {
  content: 'Lace engine is not running. Start it first.',
  isError: true,
};

/**
 * Guard: require a running engine. Returns the client or an error ToolResult.
 */
export function requireEngine(
  getRpcClient: () => JSONRPCClient | null,
): { client: JSONRPCClient } | { error: ToolResult } {
  const client = getRpcClient();
  if (!client) {
    return { error: ENGINE_NOT_RUNNING };
  }
  return { client };
}

/** Extract error message from unknown error. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
