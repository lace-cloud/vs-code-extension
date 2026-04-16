// src/chat/tools/generate-tools.ts
//
// Tools: lace_auto_connect, lace_generate
// All operations go through RPC to the CLI.

import type { LaceTransport } from '../types';
import type { CanvasView } from '../types';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { requireEngine, errorMessage } from './helpers';

export type GenerateToolDeps = {
  getRpcClient: () => LaceTransport | null;
  getLaceDir: () => string | undefined;
  getCanvasView?: () => CanvasView | undefined;
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

      // Count new edges involving these instances
      const relevantEdges = canvasView.edges.filter(
        (e) => e.source === sourceInstance && e.target === targetInstance,
      );

      if (relevantEdges.length === 0) {
        // Fetch both node configs to show available ports
        const lines: string[] = [
          `No compatible connections found between "${sourceInstance}" and "${targetInstance}".`,
          '',
        ];
        try {
          const srcConfig = await engineResult.client.queryNodeConfig({
            instance_id: sourceInstance,
          });
          const tgtConfig = await engineResult.client.queryNodeConfig({
            instance_id: targetInstance,
          });
          const srcOutputs = srcConfig.outputs.map((o) => `\`${o.name}\` (${o.type})`);
          const tgtInputs = tgtConfig.inputs
            .filter((i) => i.mode === 'empty')
            .map((i) => `\`${i.name}\` (${i.type}${i.required ? ', required' : ''})`);
          lines.push(`**${sourceInstance}** outputs: ${srcOutputs.join(', ') || '(none)'}`);
          lines.push(`**${targetInstance}** unbound inputs: ${tgtInputs.join(', ') || '(none)'}`);
          lines.push('');
          lines.push('Use lace_connect to wire manually if types are compatible.');
        } catch {
          lines.push(
            'Use lace_inspect_node on each instance to see available outputs and inputs, then connect manually with lace_connect.',
          );
        }
        return { content: lines.join('\n') };
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

    // Save canvas before generating to avoid stale output
    try {
      const view = deps.getCanvasView?.();
      if (view?.is_dirty) {
        await engineResult.client.sessionSave();
      }
    } catch {
      // Non-fatal — proceed with generation
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
        const lines = diagnosticErrors.map((d) => {
          const loc = d.file && d.line ? ` [${d.file}:${d.line}]` : d.file ? ` [${d.file}]` : '';
          return `- ${loc}${d.message}`;
        });
        return {
          content: `Generation failed with ${diagnosticErrors.length} error(s):\n${lines.join('\n')}`,
          isError: true,
        };
      }

      const filesWritten = result?.files_written ?? [];
      const fileList =
        filesWritten.length > 0
          ? `\n\nFiles written to ${laceDir}/:\n${filesWritten.map((f) => `- ${f}`).join('\n')}`
          : '';

      return {
        content: `Terraform generated successfully.${fileList}`,
      };
    } catch (err: unknown) {
      return { content: `Failed to generate Terraform: ${errorMessage(err)}`, isError: true };
    }
  });
}
