// src/chat/tools/graph-read-tools.ts
//
// Tools: lace_describe_graph, lace_validate_graph, lace_inspect_node, lace_get_settings
// All operations go through RPC to the CLI.

import type { LaceClient } from '../../utilities/engine/grpc-client';
import type { CanvasView } from '../../webview/types/render';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { requireEngine, errorMessage } from './helpers';

export type GraphReadDeps = {
  getRpcClient: () => LaceClient | null;
  getCanvasView?: () => CanvasView | undefined;
};

// ── Structured canvas summary from in-memory CanvasView ──

function buildCanvasSummary(view: CanvasView): string {
  const lines: string[] = [];

  if (view.nodes.length === 0) {
    lines.push('Canvas is empty — no modules added yet.');
    return lines.join('\n');
  }

  lines.push(`**Canvas: ${view.nodes.length} instance(s), ${view.edges.length} connection(s)**`);
  lines.push('');
  lines.push('### Instances');
  for (const node of view.nodes) {
    const errFlag = node.has_errors ? ' ⚠ has errors' : '';
    lines.push(`- **${node.id}** (${node.label})${errFlag}`);
  }

  if (view.edges.length > 0) {
    lines.push('');
    lines.push('### Connections');
    for (const edge of view.edges) {
      lines.push(`- ${edge.source}.${edge.source_output} → ${edge.target}.${edge.target_input}`);
    }
  }

  if (view.errors.length > 0) {
    lines.push('');
    lines.push('### Errors');
    for (const err of view.errors) {
      const loc = [err.instance_id, err.input_name].filter(Boolean).join('.');
      lines.push(`- ${loc ? `[${loc}] ` : ''}${err.message}`);
    }
  }

  return lines.join('\n');
}

export function registerGraphReadTools(deps: GraphReadDeps): void {
  // ─────────────────────────────────────────────
  // lace_describe_graph
  // ─────────────────────────────────────────────
  registerTool('lace_describe_graph', async (): Promise<ToolResult> => {
    // Prefer structured in-memory view — deterministic instance IDs
    const view = deps.getCanvasView?.();
    if (view) {
      return { content: buildCanvasSummary(view) };
    }

    // Fallback: RPC text summary
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
      lines.push('');
      lines.push(
        'Call lace_inspect_node on affected instances to see current binding state, then use lace_set_input or lace_connect to fix.',
      );

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return { content: `Failed to validate graph: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_inspect_node — live config of a placed instance
  // ─────────────────────────────────────────────
  registerTool('lace_inspect_node', async (params): Promise<ToolResult> => {
    const instanceId = params.instance_id as string | undefined;
    if (!instanceId) {
      return { content: 'Missing required parameter: instance_id', isError: true };
    }

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const config = await engineResult.client.queryNodeConfig({ instance_id: instanceId });
      const lines: string[] = [];
      lines.push(`**Instance: ${instanceId}**`);
      lines.push('');

      if (config.inputs.length > 0) {
        lines.push('### Inputs');
        for (const inp of config.inputs) {
          const req = inp.required ? ' **(required)**' : '';
          let binding = `mode: ${inp.mode}`;
          if (inp.mode === 'literal') binding += `, value: ${JSON.stringify(inp.value)}`;
          else if (inp.mode === 'variable') binding += `, var: ${inp.variable}`;
          else if (inp.mode === 'expression') binding += `, expr: ${inp.expression}`;
          else if (inp.mode === 'wired') binding += `, from: ${inp.wired_source}`;
          else binding = 'not set';
          const desc = inp.description ? ` — ${inp.description}` : '';
          lines.push(`- \`${inp.name}\` (${inp.type})${req}: ${binding}${desc}`);
        }
      } else {
        lines.push('### Inputs: none');
      }

      lines.push('');

      if (config.outputs.length > 0) {
        lines.push('### Outputs');
        for (const out of config.outputs) {
          const desc = out.description ? ` — ${out.description}` : '';
          lines.push(`- \`${out.name}\` (${out.type})${desc}`);
        }
      } else {
        lines.push('### Outputs: none');
      }

      if (config.available_variables.length > 0) {
        lines.push('');
        lines.push('### Available variables');
        for (const v of config.available_variables) {
          lines.push(`- \`${v.name}\` (${v.type})`);
        }
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return {
        content: `Failed to inspect node "${instanceId}": ${errorMessage(err)}. Use lace_describe_graph to see current instance IDs.`,
        isError: true,
      };
    }
  });

  // ─────────────────────────────────────────────
  // lace_get_settings — terraform block, providers, locals
  // ─────────────────────────────────────────────
  registerTool('lace_get_settings', async (): Promise<ToolResult> => {
    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const settings = await engineResult.client.querySettings();
      const lines: string[] = [];
      lines.push('**Canvas Settings**');
      lines.push('');

      lines.push('### Terraform');
      lines.push(`- required_version: ${settings.terraform.required_version || '(not set)'}`);
      if (settings.terraform.required_providers.length > 0) {
        lines.push('- required_providers:');
        for (const p of settings.terraform.required_providers) {
          lines.push(`  - ${p.name}: source=${p.source}, version=${p.version}`);
        }
      } else {
        lines.push('- required_providers: (none)');
      }
      if (settings.terraform.backend) {
        lines.push(`- backend: type=${settings.terraform.backend.type}`);
      } else {
        lines.push('- backend: (not configured)');
      }

      lines.push('');
      lines.push('### Providers');
      if (settings.providers.length > 0) {
        for (const p of settings.providers) {
          const alias = p.alias ? ` (alias: ${p.alias})` : '';
          lines.push(`- ${p.name}${alias}`);
        }
      } else {
        lines.push('(none configured)');
      }

      lines.push('');
      lines.push('### Locals');
      if (settings.locals.length > 0) {
        for (const l of settings.locals) {
          lines.push(`- ${l.name}: ${l.value_display}`);
        }
      } else {
        lines.push('(none)');
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return { content: `Failed to get settings: ${errorMessage(err)}`, isError: true };
    }
  });
}
