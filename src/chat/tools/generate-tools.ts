// src/chat/tools/generate-tools.ts
//
// Tools: lace_auto_connect, lace_generate
// All operations go through RPC to the CLI.

import type { LaceClient } from '../../utilities/engine/grpc-client';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { requireEngine, errorMessage } from './helpers';

export type GenerateToolDeps = {
  getRpcClient: () => LaceClient | null;
  getLaceDir: () => string | undefined;
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

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const canvasView = await engineResult.client.autoConnect({
        source: sourceInstance,
        target: targetInstance,
      });

      // Count new edges involving these instances to determine what was connected
      const relevantEdges = canvasView.edges.filter(
        (e) => e.source === sourceInstance && e.target === targetInstance,
      );

      if (relevantEdges.length === 0) {
        return {
          content: `No compatible connections found between "${sourceInstance}" and "${targetInstance}". Use lace_describe_graph to see available outputs and inputs, then connect manually with lace_connect.`,
        };
      }

      const lines: string[] = [];
      lines.push(`Auto-connected ${relevantEdges.length} wire(s):`);
      for (const edge of relevantEdges) {
        lines.push(`- ${edge.source}.${edge.source_output} → ${edge.target}.${edge.target_input}`);
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return { content: `Failed to auto-connect: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_generate
  // ─────────────────────────────────────────────
  registerTool('lace_generate', async (): Promise<ToolResult> => {
    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    const laceDir = deps.getLaceDir();
    if (!laceDir) {
      return { content: 'No workspace folder open.', isError: true };
    }

    try {
      const result = await engineResult.client.sessionGenerate({
        output_dir: laceDir,
        options: {
          dry_run: false,
          format: true,
          validate: true,
          overwrite: true,
        },
      });

      const diagnosticErrors = (result?.diagnostics ?? []).filter((d) => d.severity === 'error');
      if (diagnosticErrors.length > 0) {
        const lines = diagnosticErrors.map((d) => `- ${d.message}`);
        return {
          content: `Generation failed with ${diagnosticErrors.length} error(s):\n${lines.join('\n')}`,
          isError: true,
        };
      }

      const fileCount = result?.files_written?.length ?? 0;
      return {
        content: `Terraform generated successfully. ${fileCount} file(s) written to ${laceDir}/`,
      };
    } catch (err: unknown) {
      return { content: `Failed to generate Terraform: ${errorMessage(err)}`, isError: true };
    }
  });
}
