// src/chat/tools/graph-write-tools.ts
//
// Write tools: lace_add_module, lace_remove_module, lace_connect,
// lace_disconnect, lace_set_input, lace_rename_instance.

import type { JSONRPCClient } from '../../utilities/engine/rpc-client';
import type { RegistryModule } from '../../types/protocol';
import type { WorkspaceState } from '../../webview/types/workspace';
import type { Binding, Bundle } from '../../webview/types/ir';
import { isUse } from '../../webview/types/ir';
import type { WorkspaceAction } from '../../webview/state/reducer';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { isValidTerraformIdentifier, parseModuleKey } from '../../webview/utils/identifiers';
import { allChildren } from '../../webview/utils/children';
import { getEntryModule, findChildInEntry, loadGraphState, requireEntry } from './helpers';

export type GraphWriteDeps = {
  getRpcClient: () => JSONRPCClient | null;
  getRegistryModules: () => RegistryModule[];
  addModuleToActiveCanvas: (deploy_bundle: Bundle, icon_url?: string) => void;
  requestGraphState: () => Promise<WorkspaceState>;
  dispatchToCanvas: (action: WorkspaceAction) => Promise<void>;
};

/**
 * Poll the canvas state to find a newly added instance by module ID.
 * Retries up to 4 times with increasing delays (200, 400, 600, 800ms = ~2s total).
 * Returns the instance ID if found, undefined otherwise.
 */
async function pollForAddedInstance(
  deps: Pick<GraphWriteDeps, 'requestGraphState'>,
  moduleId: string,
  moduleName: string,
): Promise<string | undefined> {
  const delays = [200, 400, 600, 800];
  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay));
    try {
      const state = await deps.requestGraphState();
      const entry = getEntryModule(state);
      if (!entry) continue;
      const children = allChildren(entry.mod);
      const added = [...children].reverse().find((child) => {
        if (!isUse(child)) return false;
        const { id } = parseModuleKey(child.module);
        return id === moduleId || id === moduleName;
      });
      if (added) return added.id;
    } catch {
      // State read failed, retry
    }
  }
  return undefined;
}

// ── Tool Registration ──

export function registerGraphWriteTools(deps: GraphWriteDeps): void {
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

    const client = deps.getRpcClient();
    if (!client) {
      return { content: 'Lace engine is not running. Start it first.', isError: true };
    }

    try {
      const response = await client.getRegistryVersion({
        name: match.name,
        system: match.system,
        version: match.version,
      });

      const deploy_bundle = response?.deploy_bundle;
      if (!deploy_bundle) {
        return { content: 'Registry returned no deploy bundle for this module.', isError: true };
      }

      deps.addModuleToActiveCanvas(deploy_bundle, match.icon_url);

      // Poll for the newly added instance (canvas processes the drop async)
      const instanceId = await pollForAddedInstance(deps, match.id, match.name);

      if (instanceId) {
        return {
          content: `Added **${match.name}** (${match.system}, v${match.version}) to the canvas as instance "${instanceId}".`,
        };
      }

      return {
        content: `Added **${match.name}** (${match.system}, v${match.version}) to the canvas. Use lace_describe_graph to find the instance ID.`,
      };
    } catch (err: any) {
      return {
        content: `Failed to fetch module from registry: ${err.message}`,
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

    const result = await loadGraphState(deps.requestGraphState);
    if ('error' in result) return result.error;
    const { state } = result;

    const entryResult = requireEntry(state);
    if ('error' in entryResult) return entryResult.error;
    const { entry } = entryResult;

    const children = allChildren(entry.mod);
    const child = children.find((c) => c.id === instanceId);
    if (!child) {
      const ids = children.map((c) => c.id);
      return {
        content: `Instance "${instanceId}" not found. Available instances: ${ids.join(', ')}`,
        isError: true,
      };
    }

    try {
      await deps.dispatchToCanvas({
        type: 'DELETE_INSTANCE',
        module_key: entry.entryKey,
        instance_id: instanceId,
      });
      return { content: `Removed instance "${instanceId}" from the canvas.` };
    } catch (err: any) {
      return { content: `Failed to remove instance: ${err.message}`, isError: true };
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

    const result = await loadGraphState(deps.requestGraphState);
    if ('error' in result) return result.error;
    const { state } = result;

    const entryResult = requireEntry(state);
    if ('error' in entryResult) return entryResult.error;
    const { entry } = entryResult;

    // Validate instances exist
    const source = findChildInEntry(state, sourceInstance);
    const target = findChildInEntry(state, targetInstance);
    if (!source) {
      return { content: `Source instance "${sourceInstance}" not found.`, isError: true };
    }
    if (!target) {
      return { content: `Target instance "${targetInstance}" not found.`, isError: true };
    }

    try {
      await deps.dispatchToCanvas({
        type: 'CONNECT',
        module_key: entry.entryKey,
        source_instance: sourceInstance,
        target_instance: targetInstance,
        mapping: { from: sourceOutput, to: targetInput },
      });
      return {
        content: `Connected ${sourceInstance}.${sourceOutput} → ${targetInstance}.${targetInput}`,
      };
    } catch (err: any) {
      return { content: `Failed to connect: ${err.message}`, isError: true };
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

    const result = await loadGraphState(deps.requestGraphState);
    if ('error' in result) return result.error;
    const { state } = result;

    const entryResult = requireEntry(state);
    if ('error' in entryResult) return entryResult.error;
    const { entry } = entryResult;

    const target = findChildInEntry(state, targetInstance);
    if (!target) {
      return { content: `Instance "${targetInstance}" not found.`, isError: true };
    }

    try {
      await deps.dispatchToCanvas({
        type: 'DISCONNECT',
        module_key: entry.entryKey,
        target_instance: targetInstance,
        input_name: inputName,
      });
      return { content: `Disconnected input "${inputName}" on instance "${targetInstance}".` };
    } catch (err: any) {
      return { content: `Failed to disconnect: ${err.message}`, isError: true };
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

    let binding: Binding;
    if (hasValue) {
      binding = { lit: params.value };
    } else if (hasVariable) {
      binding = { var: params.variable as string };
    } else {
      binding = { expr: { lang: 'hcl', value: params.expression as string } };
    }

    const result = await loadGraphState(deps.requestGraphState);
    if ('error' in result) return result.error;
    const { state } = result;

    const entryResult = requireEntry(state);
    if ('error' in entryResult) return entryResult.error;
    const { entry } = entryResult;

    const inst = findChildInEntry(state, instanceId);
    if (!inst) {
      return { content: `Instance "${instanceId}" not found.`, isError: true };
    }

    // Merge with existing inputs
    const mergedInputs: Record<string, Binding> = {
      ...(inst.inputs ?? {}),
      [inputName]: binding,
    };

    try {
      await deps.dispatchToCanvas({
        type: 'UPDATE_INPUTS',
        module_key: entry.entryKey,
        instance_id: instanceId,
        inputs: mergedInputs,
      });

      const desc =
        'lit' in binding
          ? `literal ${JSON.stringify(binding.lit)}`
          : 'var' in binding
            ? `variable "${binding.var}"`
            : `expression "${binding.expr.value}"`;
      return {
        content: `Set ${instanceId}.${inputName} to ${desc}.`,
      };
    } catch (err: any) {
      return { content: `Failed to set input: ${err.message}`, isError: true };
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

    const result = await loadGraphState(deps.requestGraphState);
    if ('error' in result) return result.error;
    const { state } = result;

    const entryResult = requireEntry(state);
    if ('error' in entryResult) return entryResult.error;
    const { entry } = entryResult;

    const inst = findChildInEntry(state, oldId);
    if (!inst) {
      return { content: `Instance "${oldId}" not found.`, isError: true };
    }

    // Check for collision
    const children = allChildren(entry.mod);
    const existing = children.find((c) => c.id === newId);
    if (existing) {
      return { content: `Instance "${newId}" already exists.`, isError: true };
    }

    try {
      await deps.dispatchToCanvas({
        type: 'RENAME_INSTANCE',
        module_key: entry.entryKey,
        old_id: oldId,
        new_id: newId,
      });
      return { content: `Renamed instance "${oldId}" to "${newId}".` };
    } catch (err: any) {
      return { content: `Failed to rename instance: ${err.message}`, isError: true };
    }
  });
}
