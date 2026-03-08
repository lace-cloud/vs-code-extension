// src/chat/tools/generate-tools.ts
//
// Tools: lace_auto_connect, lace_generate

import type { WorkspaceState } from '../../webview/types/workspace';
import type { WorkspaceAction } from '../../webview/state/reducer';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { resolveSchema } from '../../webview/utils/resolve';
import { findAutoConnections } from '../auto-connect';
import { findChild } from '../../webview/utils/children';

export type GenerateToolDeps = {
  requestGraphState: () => Promise<WorkspaceState>;
  dispatchToCanvas: (action: WorkspaceAction) => Promise<void>;
  triggerGenerate: () => void;
};

export function registerGenerateTools(deps: GenerateToolDeps): void {
  // ─────────────────────────────────────────────
  // lace_auto_connect
  // ─────────────────────────────────────────────
  registerTool('lace_auto_connect', async (params): Promise<ToolResult> => {
    const sourceInstance = params.source_instance as string | undefined;
    const targetInstance = params.target_instance as string | undefined;

    if (!sourceInstance || !targetInstance) {
      return {
        content: 'Missing required parameters: source_instance, target_instance',
        isError: true,
      };
    }

    let state: WorkspaceState;
    try {
      state = await deps.requestGraphState();
    } catch (err: any) {
      return { content: `Cannot read canvas: ${err.message}`, isError: true };
    }

    const entryKey = state.entry;
    const entryDef = state.modules[entryKey];
    if (!entryDef) {
      return { content: 'Canvas has no composite graph.', isError: true };
    }

    const source = findChild(entryDef, sourceInstance);
    const target = findChild(entryDef, targetInstance);

    if (!source) {
      return { content: `Source instance "${sourceInstance}" not found.`, isError: true };
    }
    if (!target) {
      return { content: `Target instance "${targetInstance}" not found.`, isError: true };
    }

    const sourceSchema = resolveSchema(state, source);
    const targetSchema = resolveSchema(state, target);

    // Find which target inputs already have any binding (lit, var, expr, out)
    const boundInputNames = new Set<string>(Object.keys(target.inputs ?? {}));

    const matches = findAutoConnections(sourceSchema.outputs, targetSchema.inputs, boundInputNames);

    if (matches.length === 0) {
      return {
        content: `No compatible connections found between "${sourceInstance}" and "${targetInstance}". Use lace_describe_graph to see available outputs and inputs, then connect manually with lace_connect.`,
      };
    }

    // Dispatch CONNECT for each match
    const connected: string[] = [];
    const failed: string[] = [];

    for (const match of matches) {
      try {
        await deps.dispatchToCanvas({
          type: 'CONNECT',
          module_key: entryKey,
          source_instance: sourceInstance,
          target_instance: targetInstance,
          mapping: { from: match.from, to: match.to },
        });
        connected.push(
          `${sourceInstance}.${match.from} → ${targetInstance}.${match.to} (score: ${match.score})`,
        );
      } catch (err: any) {
        failed.push(`${match.from} → ${match.to}: ${err.message}`);
      }
    }

    const lines: string[] = [];
    if (connected.length > 0) {
      lines.push(`Auto-connected ${connected.length} wire(s):`);
      for (const c of connected) lines.push(`- ${c}`);
    }
    if (failed.length > 0) {
      lines.push(`Failed ${failed.length} connection(s):`);
      for (const f of failed) lines.push(`- ${f}`);
    }

    return { content: lines.join('\n'), isError: failed.length > 0 && connected.length === 0 };
  });

  // ─────────────────────────────────────────────
  // lace_generate
  // ─────────────────────────────────────────────
  registerTool('lace_generate', async (): Promise<ToolResult> => {
    try {
      deps.triggerGenerate();
      return {
        content:
          'Terraform generation triggered. The canvas will validate the graph and generate .tf files in the .lace/ directory.',
      };
    } catch (err: any) {
      return { content: `Failed to trigger generation: ${err.message}`, isError: true };
    }
  });
}
