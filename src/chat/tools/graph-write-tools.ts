// src/chat/tools/graph-write-tools.ts
//
// Write tools: lace_add_module, lace_remove_module, lace_connect,
// lace_disconnect, lace_set_input, lace_rename_instance.
// All operations go through RPC to the CLI.

import type { LaceClient } from '../../utilities/engine/grpc-client';
import type { RegistryModule } from '../../types/protocol';
import type { CanvasView } from '../../webview/types/render';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { isValidTerraformIdentifier } from '../../webview/utils/identifiers';
import { requireEngine, errorMessage } from './helpers';

export type GraphWriteDeps = {
  getRpcClient: () => LaceClient | null;
  getRegistryModules: () => RegistryModule[];
  publishCanvasView?: (state: CanvasView) => void;
};

// ── Tool Registration ──

export function registerGraphWriteTools(deps: GraphWriteDeps): void {
  const publishCanvasView = (state: CanvasView) => deps.publishCanvasView?.(state);

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
        const names = candidates.slice(0, 5).map((m) => `${m.name} (${m.system})`);
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

      // Step 2: Apply deploy bundle to canvas
      const canvasView = await engineResult.client.dropBundle({
        deploy_bundle: deployBundle,
      });
      publishCanvasView(canvasView);

      // Find the newly added node from the returned canvas view
      const addedNode = canvasView.nodes.find(
        (n) => n.module_key && n.module_key.includes(match!.id),
      );
      const instanceId = addedNode?.id;

      if (instanceId) {
        return {
          content: `Added **${match.name}** (${match.system}, v${match.version}) to the canvas as instance "${instanceId}".`,
        };
      }

      return {
        content: `Added **${match.name}** (${match.system}, v${match.version}) to the canvas. Use lace_describe_graph to find the instance ID.`,
      };
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

    try {
      const canvasView = await engineResult.client.deleteInstance({ instance_id: instanceId });
      publishCanvasView(canvasView);
      return { content: `Removed instance "${instanceId}" from the canvas.` };
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
          'Missing required parameters: source_instance, target_instance, source_output, target_input',
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
      return { content: `Failed to connect: ${errorMessage(err)}`, isError: true };
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
      return {
        content: `Set ${instanceId}.${inputName} to ${desc}.`,
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
      return { content: `Renamed instance "${oldId}" to "${newId}".` };
    } catch (err: unknown) {
      return { content: `Failed to rename instance: ${errorMessage(err)}`, isError: true };
    }
  });
}
