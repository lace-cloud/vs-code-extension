// src/chat/tools/helpers.ts
//
// Shared helpers for chat tool implementations.

import type { ToolResult } from '@lace-cloud/chat-core';
import type { LaceTransport } from '@lace-cloud/host';

const ENGINE_NOT_RUNNING: ToolResult = {
  content:
    'Lace engine is not running. Ask the user to start it with **Lace: Start Engine** from the Command Palette, then retry.',
  isError: true,
};

/**
 * Guard: require a running engine. Returns the client or an error ToolResult.
 */
export function requireEngine(
  getRpcClient: () => LaceTransport | null,
): { client: LaceTransport } | { error: ToolResult } {
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
