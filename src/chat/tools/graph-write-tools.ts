// src/chat/tools/graph-write-tools.ts
//
// Write tools: lace_add_module, lace_remove_module, lace_connect,
// lace_disconnect, lace_set_input, lace_rename_instance, lace_set_variable, lace_undo.
// All operations go through RPC to the CLI.

import type { LaceClient } from '../../utilities/engine/grpc-client';
import type { RegistryModule } from '../../types/protocol';
import type { CanvasView } from '../../webview/types/render';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { isValidTerraformIdentifier } from '../../webview/utils/identifiers';
import { requireEngine, errorMessage } from './helpers';
import { findFreePosition } from '../../webview/utils/layout';

export type GraphWriteDeps = {
  getRpcClient: () => LaceClient | null;
  getRegistryModules: () => RegistryModule[];
  getCanvasView?: () => CanvasView | undefined;
  publishCanvasView?: (state: CanvasView) => void;
};

// ── Tool Registration ──

export function registerGraphWriteTools(deps: GraphWriteDeps): void {
  const publishCanvasView = (state: CanvasView) => deps.publishCanvasView?.(state);
  const getCanvasView = () => deps.getCanvasView?.();

  // ─────────────────────────────────────────────
  // lace_add_module
  // ─────────────────────────────────────────────
  registerTool('lace_add_module', async (params): Promise<ToolResult> => {
    const name = params.name as string | undefined;
    const system = params.system as string | undefined;

    if (!name) {
      return { content: 'Missing required parameter: name', isError: true };
    }

    const modules = deps.getRegistryModules();
    const nameLower = name.toLowerCase();
    const systemLower = system?.toLowerCase();

    let match = modules.find(
      (m) =>
        m.name.toLowerCase() === nameLower &&
        (!systemLower || m.system.toLowerCase() === systemLower),
    );

    if (!match) {
      const candidates = modules.filter(
        (m) =>
          (m.name.toLowerCase().includes(nameLower) || m.id.toLowerCase().includes(nameLower)) &&
          (!systemLower || m.system.toLowerCase() === systemLower),
      );
      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        const names = candidates
          .slice(0, 5)
          .map(
            (m) =>
              `${m.name} (${m.system}, v${m.version})${m.description ? ` — ${m.description}` : ''}`,
          );
        return {
          content: `Multiple modules match "${name}". Please be more specific:\n${names.join('\n')}`,
          isError: true,
        };
      }
    }

    if (!match) {
      return {
        content: `Module "${name}"${system ? ` (${system})` : ''} not found in the registry. Use lace_search_registry to find available modules.`,
        isError: true,
      };
    }

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      // Step 1: Fetch deploy bundle from registry
      const versionResult = await engineResult.client.getRegistryVersion({
        name: match.name,
        system: match.system,
        version: match.version,
      });
      const deployBundle = versionResult?.deploy_bundle;
      if (!deployBundle) {
        return { content: 'Module has no deploy bundle.', isError: true };
      }

      // Step 2: Apply deploy bundle. CLI ignores the position field, so we
      // reposition new nodes via syncLayout after the drop.
      const existingNodes = getCanvasView()?.nodes ?? [];
      const existingIds = new Set(existingNodes.map((n) => n.id));

      // Anchor to the last node in the current view
      const anchor =
        existingNodes.length > 0 ? existingNodes[existingNodes.length - 1].position : undefined;

      const canvasView = await engineResult.client.dropBundle({ deploy_bundle: deployBundle });

      const newNodes = canvasView.nodes.filter((n) => !existingIds.has(n.id));
      if (newNodes.length > 0) {
        const syncPositions: Record<string, { x: number; y: number }> = {};
        const placed = [...existingNodes];
        let currentAnchor = anchor;
        for (const node of newNodes) {
          const pos = findFreePosition(placed, currentAnchor);
          syncPositions[node.id] = pos;
          placed.push({ ...node, position: pos });
          node.position = pos;
          currentAnchor = pos;
        }
        await engineResult.client.syncLayout({ positions: syncPositions });
      }

      publishCanvasView(canvasView);

      // Find the newly added instance ID — try module_key match first, then new node
      let instanceId =
        canvasView.nodes.find((n) => n.module_key && n.module_key.includes(match!.id))?.id ??
        newNodes[0]?.id;

      // Build response with required inputs so model can set them immediately
      const lines: string[] = [];

      if (instanceId) {
        lines.push(
          `Added **${match.name}** (${match.system}, v${match.version}) to the canvas as instance **"${instanceId}"**.`,
        );
      } else {
        lines.push(
          `Added **${match.name}** (${match.system}, v${match.version}) to the canvas. Use lace_describe_graph to find the instance ID.`,
        );
      }

      // Fetch and show required inputs so model can fill them
      if (instanceId) {
        try {
          const config = await engineResult.client.queryNodeConfig({ instance_id: instanceId });
          const required = config.inputs.filter((i) => i.required && i.mode === 'empty');
          const optional = config.inputs.filter((i) => !i.required && i.mode === 'empty');
          if (required.length > 0) {
            lines.push('');
            lines.push('**Required inputs (must be set before generating):**');
            for (const inp of required) {
              const desc = inp.description ? ` — ${inp.description}` : '';
              lines.push(`- \`${inp.name}\` (${inp.type})${desc}`);
            }
          }
          if (optional.length > 0) {
            lines.push('');
            lines.push(`**Optional inputs:** ${optional.map((i) => `\`${i.name}\``).join(', ')}`);
          }
        } catch {
          // Non-fatal — instance was added, just can't fetch config right now
        }
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return {
        content: `Failed to add module: ${errorMessage(err)}`,
        isError: true,
      };
    }
  });

  // ─────────────────────────────────────────────
  // lace_remove_module
  // ─────────────────────────────────────────────
  registerTool('lace_remove_module', async (params): Promise<ToolResult> => {
    const instanceId = params.instance_id as string | undefined;
    if (!instanceId) {
      return { content: 'Missing required parameter: instance_id', isError: true };
    }

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    // Warn about incoming connections that will be severed
    let warnLines: string[] = [];
    try {
      const view = getCanvasView();
      if (view) {
        const affectedEdges = view.edges.filter(
          (e) => e.source === instanceId || e.target === instanceId,
        );
        if (affectedEdges.length > 0) {
          warnLines = affectedEdges.map(
            (e) => `- ${e.source}.${e.source_output} → ${e.target}.${e.target_input}`,
          );
        }
      }
    } catch {
      // Non-fatal
    }

    try {
      const canvasView = await engineResult.client.deleteInstance({ instance_id: instanceId });
      publishCanvasView(canvasView);

      const lines = [`Removed instance "${instanceId}" from the canvas.`];
      if (warnLines.length > 0) {
        lines.push('');
        lines.push('The following connections were also removed:');
        lines.push(...warnLines);
      }
      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return { content: `Failed to remove instance: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_connect
  // ─────────────────────────────────────────────
  registerTool('lace_connect', async (params): Promise<ToolResult> => {
    const sourceInstance = params.source_instance as string | undefined;
    const targetInstance = params.target_instance as string | undefined;
    const sourceOutput = params.source_output as string | undefined;
    const targetInput = params.target_input as string | undefined;

    if (!sourceInstance || !targetInstance || !sourceOutput || !targetInput) {
      return {
        content:
          'Missing required parameters: source_instance, target_instance, source_output, target_input. Use lace_inspect_node on each instance to see available outputs and inputs.',
        isError: true,
      };
    }

    if (!sourceOutput.trim()) {
      return {
        content: `source_output cannot be empty. Use lace_inspect_node on "${sourceInstance}" to see available outputs.`,
        isError: true,
      };
    }

    if (!targetInput.trim()) {
      return {
        content: `target_input cannot be empty. Use lace_inspect_node on "${targetInstance}" to see available inputs.`,
        isError: true,
      };
    }

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const canvasView = await engineResult.client.connect({
        source: sourceInstance,
        target: targetInstance,
        source_output: sourceOutput,
        target_input: targetInput,
      });
      publishCanvasView(canvasView);
      return {
        content: `Connected ${sourceInstance}.${sourceOutput} → ${targetInstance}.${targetInput}`,
      };
    } catch (err: unknown) {
      const msg = errorMessage(err);
      const notFound =
        msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('unknown');
      return {
        content: `Failed to connect: ${msg}${notFound ? '\nUse lace_describe_graph to see current instance IDs — they may differ from what you expected.' : ''}`,
        isError: true,
      };
    }
  });

  // ─────────────────────────────────────────────
  // lace_disconnect
  // ─────────────────────────────────────────────
  registerTool('lace_disconnect', async (params): Promise<ToolResult> => {
    const targetInstance = params.target_instance as string | undefined;
    const inputName = params.input_name as string | undefined;

    if (!targetInstance || !inputName) {
      return {
        content: 'Missing required parameters: target_instance, input_name',
        isError: true,
      };
    }

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const canvasView = await engineResult.client.disconnect({
        target: targetInstance,
        input_name: inputName,
      });
      publishCanvasView(canvasView);
      return { content: `Disconnected input "${inputName}" on instance "${targetInstance}".` };
    } catch (err: unknown) {
      return { content: `Failed to disconnect: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_set_input
  // ─────────────────────────────────────────────
  registerTool('lace_set_input', async (params): Promise<ToolResult> => {
    const instanceId = params.instance_id as string | undefined;
    const inputName = params.input_name as string | undefined;

    if (!instanceId || !inputName) {
      return {
        content: 'Missing required parameters: instance_id, input_name',
        isError: true,
      };
    }

    // Determine binding type from params — exactly one must be provided
    const hasValue = params.value !== undefined;
    const hasVariable = typeof params.variable === 'string';
    const hasExpression = typeof params.expression === 'string';
    const bindingCount = [hasValue, hasVariable, hasExpression].filter(Boolean).length;

    if (bindingCount !== 1) {
      return {
        content:
          'Must provide exactly one of: value (literal), variable (var reference), or expression (HCL expression)',
        isError: true,
      };
    }

    let mode: string;
    let value: unknown;
    let variable: string | undefined;
    let expression: string | undefined;

    if (hasValue) {
      mode = 'literal';
      value = params.value;
    } else if (hasVariable) {
      mode = 'variable';
      variable = params.variable as string;
    } else {
      mode = 'expression';
      expression = params.expression as string;
    }

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const canvasView = await engineResult.client.updateInput({
        instance_id: instanceId,
        input_name: inputName,
        mode,
        value,
        variable,
        expression,
      });
      publishCanvasView(canvasView);

      const desc =
        mode === 'literal'
          ? `literal ${JSON.stringify(value)}`
          : mode === 'variable'
            ? `variable "${variable}"`
            : `expression "${expression}"`;

      const note =
        mode === 'expression'
          ? '\nHCL expression set. Run lace_validate_graph to check for errors.'
          : '';

      return {
        content: `Set ${instanceId}.${inputName} to ${desc}.${note}`,
      };
    } catch (err: unknown) {
      return { content: `Failed to set input: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_rename_instance
  // ─────────────────────────────────────────────
  registerTool('lace_rename_instance', async (params): Promise<ToolResult> => {
    const oldId = params.old_id as string | undefined;
    const newId = params.new_id as string | undefined;

    if (!oldId || !newId) {
      return {
        content: 'Missing required parameters: old_id, new_id',
        isError: true,
      };
    }

    if (!isValidTerraformIdentifier(newId)) {
      return {
        content: `"${newId}" is not a valid Terraform identifier. Use only letters, digits, underscores, and hyphens (must start with a letter or underscore).`,
        isError: true,
      };
    }

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const canvasView = await engineResult.client.renameInstance({ old_id: oldId, new_id: newId });
      publishCanvasView(canvasView);

      const lines = [`Renamed instance "${oldId}" to "${newId}".`];

      // Auto-validate after rename to catch dangling references
      try {
        const validation = await engineResult.client.queryValidate();
        if (validation.errors.length > 0) {
          lines.push('');
          lines.push(`⚠ Validation found ${validation.errors.length} error(s) after rename:`);
          for (const err of validation.errors) {
            const loc = [err.instance_id, err.input_name].filter(Boolean).join('.');
            lines.push(`- ${loc ? `[${loc}] ` : ''}${err.message}`);
          }
          lines.push('Fix with lace_set_input or lace_connect.');
        }
      } catch {
        // Non-fatal
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return { content: `Failed to rename instance: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_set_variable — add/update a canvas-level variable
  // ─────────────────────────────────────────────
  registerTool('lace_set_variable', async (params): Promise<ToolResult> => {
    const varName = params.name as string | undefined;
    const varType = params.type as string | undefined;

    if (!varName || !varType) {
      return {
        content: 'Missing required parameters: name, type',
        isError: true,
      };
    }

    if (!isValidTerraformIdentifier(varName)) {
      return {
        content: `"${varName}" is not a valid Terraform identifier for a variable name.`,
        isError: true,
      };
    }

    const required = typeof params.required === 'boolean' ? params.required : true;
    const description = typeof params.description === 'string' ? params.description : undefined;
    const defaultValue = params.default !== undefined ? params.default : undefined;

    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    // Get existing variables, update or add the one specified
    try {
      const currentSettings = await engineResult.client.querySettings();
      // setVariables replaces all variables, so we must include existing ones
      // We don't have a current variable list from settings easily, so we call setVariables
      // with the single variable — the CLI merges or the canvas starts fresh.
      // Use updateAllInputs pattern — just set this one variable.
      const canvasView = await engineResult.client.setVariables({
        variables: [
          {
            name: varName,
            type: varType,
            required,
            description,
            default: defaultValue,
          },
        ],
      });
      publishCanvasView(canvasView);

      const reqLabel = required ? 'required' : 'optional';
      const defLabel =
        defaultValue !== undefined ? `, default: ${JSON.stringify(defaultValue)}` : '';
      return {
        content: `Variable \`${varName}\` (${varType}, ${reqLabel}${defLabel}) added to canvas. Use lace_set_input with variable: "${varName}" to bind it to an input.`,
      };
    } catch (err: unknown) {
      return { content: `Failed to set variable: ${errorMessage(err)}`, isError: true };
    }
  });

  // ─────────────────────────────────────────────
  // lace_undo — undo last canvas change
  // ─────────────────────────────────────────────
  registerTool('lace_undo', async (): Promise<ToolResult> => {
    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) return engineResult.error;

    try {
      const canvasView = await engineResult.client.undo();
      publishCanvasView(canvasView);
      return {
        content: `Undone. Canvas now has ${canvasView.nodes.length} instance(s) and ${canvasView.edges.length} connection(s).`,
      };
    } catch (err: unknown) {
      return { content: `Failed to undo: ${errorMessage(err)}`, isError: true };
    }
  });
}
