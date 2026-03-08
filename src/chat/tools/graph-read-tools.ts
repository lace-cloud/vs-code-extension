// src/chat/tools/graph-read-tools.ts
//
// Tools: lace_describe_graph, lace_validate_graph
// All operations go through RPC to the CLI.

import type { JSONRPCClient } from '../../utilities/engine/rpc-client';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { requireEngine, errorMessage } from './helpers';

export type GraphReadDeps = {
  getRpcClient: () => JSONRPCClient | null;
};

export function registerGraphReadTools(deps: GraphReadDeps): void {
  registerTool('lace_describe_graph', async (): Promise<ToolResult> => {
    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const result = await engineResult.client.queryGraphSummary();
      return { content: result.text };
    } catch (err: unknown) {
      return { content: `Failed to describe graph: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_validate_graph
  // ─────────────────────────────────────────────
  registerTool('lace_validate_graph', async (): Promise<ToolResult> => {
    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const result = await engineResult.client.queryValidate();
      const errors = result.errors;

      if (errors.length === 0) {
        return { content: 'Validation passed. No errors found.' };
      }

      const lines: string[] = [];
      lines.push(`**Validation: ${errors.length} error(s) found**`);
      lines.push('');
      for (const err of errors) {
        const loc = [err.instance_id, err.input_name].filter(Boolean).join('.');
        lines.push(`- ${loc ? `[${loc}] ` : ''}${err.message}`);
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return { content: `Failed to validate graph: ${errorMessage(err)}`, isError: true };
    }
  });
}
