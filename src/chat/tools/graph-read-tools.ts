// src/chat/tools/graph-read-tools.ts
//
// Tools: lace_describe_graph, lace_validate_graph

import type { WorkspaceState } from '../../webview/types/workspace';
import type { ToolResult } from '../types';
import { summarizeGraph } from '../graph-summary';
import { validateWorkspace } from '../../webview/utils/validate';
import { registerTool } from '../tool-registry';

export type GraphReadDeps = {
  requestGraphState: () => Promise<WorkspaceState>;
};

export function registerGraphReadTools(deps: GraphReadDeps): void {
  registerTool('lace_describe_graph', async (): Promise<ToolResult> => {
    let state: WorkspaceState;
    try {
      state = await deps.requestGraphState();
    } catch (err: any) {
      return { content: `Cannot read canvas: ${err.message}`, isError: true };
    }

    const summary = summarizeGraph(state);

    if (summary.instance_count === 0) {
      return { content: 'The canvas is empty. No modules have been added yet.' };
    }

    const lines: string[] = [];
    lines.push(`**Canvas: ${summary.module_name}** (${summary.instance_count} instance(s))`);
    lines.push('');

    // Instances
    lines.push('### Instances');
    for (const inst of summary.instances) {
      const version = inst.version ? ` v${inst.version}` : '';
      lines.push(`- **${inst.id}** (${inst.module_id}${version}, ${inst.kind})`);

      // Show bound inputs
      for (const [name, desc] of Object.entries(inst.inputs)) {
        lines.push(`  - ${name}: ${desc}`);
      }

      // Show unbound required inputs
      if (inst.unbound_required_inputs.length > 0) {
        lines.push(`  - ⚠ unbound required: ${inst.unbound_required_inputs.join(', ')}`);
      }

      // Show outputs
      if (inst.outputs.length > 0) {
        lines.push(`  - outputs: ${inst.outputs.join(', ')}`);
      }
    }

    // Connections
    if (summary.connections.length > 0) {
      lines.push('');
      lines.push('### Connections');
      for (const conn of summary.connections) {
        lines.push(
          `- ${conn.from_instance}.${conn.from_output} → ${conn.to_instance}.${conn.to_input}`,
        );
      }
    }

    // Variables
    if (summary.variables.length > 0) {
      lines.push('');
      lines.push(`### Variables: ${summary.variables.join(', ')}`);
    }

    // Exports
    if (summary.exports.length > 0) {
      lines.push('');
      lines.push(`### Exports: ${summary.exports.join(', ')}`);
    }

    // Global unbound
    if (summary.unbound_required_inputs.length > 0) {
      lines.push('');
      lines.push('### Unbound Required Inputs');
      for (const u of summary.unbound_required_inputs) {
        lines.push(`- ${u.instance_id}.${u.input_name} (${u.type})`);
      }
    }

    return { content: lines.join('\n') };
  });

  // ─────────────────────────────────────────────
  // lace_validate_graph
  // ─────────────────────────────────────────────
  registerTool('lace_validate_graph', async (): Promise<ToolResult> => {
    let state: WorkspaceState;
    try {
      state = await deps.requestGraphState();
    } catch (err: any) {
      return { content: `Cannot read canvas: ${err.message}`, isError: true };
    }

    const errors = validateWorkspace(state);

    if (errors.length === 0) {
      return { content: 'Validation passed. No errors found.' };
    }

    const lines: string[] = [];
    lines.push(`**Validation: ${errors.length} error(s) found**`);
    lines.push('');
    for (const err of errors) {
      const loc = [err.module_key, err.instance_id, err.input_name].filter(Boolean).join('.');
      lines.push(`- ${loc ? `[${loc}] ` : ''}${err.message}`);
    }

    return { content: lines.join('\n') };
  });
}
