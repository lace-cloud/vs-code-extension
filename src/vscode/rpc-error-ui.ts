// VS Code-specific UI surface for RPC errors.
//
// The pure classifier + RpcError class live in @lace-cloud/host and are
// portable to non-vscode consumers. The toast-shower belongs to the
// extension shell.

import { classifyRpcError, RpcError } from '@lace-cloud/host';
import * as vscode from 'vscode';

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
