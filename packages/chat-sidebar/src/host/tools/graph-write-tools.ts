// src/chat/tools/graph-write-tools.ts
//
// Write tools: lace_add_module, lace_remove_module, lace_connect,
// lace_disconnect, lace_set_input, lace_rename_instance, lace_set_variable, lace_undo.
// All operations go through RPC to the CLI.

import type { LaceTransport } from '../types';
import type { RegistryModule } from '../types';
import type { CanvasView } from '../types';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { requireEngine, errorMessage } from './helpers';

export type GraphWriteDeps = {
  getRpcClient: () => LaceTransport | null;
  getRegistryModules: () => RegistryModule[];
  getUserOrgs: () => Array<{ slug: string; name: string; role: string }>;
  getCanvasView: () => CanvasView | null;
};

// ── Tool Registration ──

export function registerGraphWriteTools(deps: GraphWriteDeps): void {
  // ─────────────────────────────────────────────
  // lace_add_module
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_add_module',
      description: 'Add a Terraform module to the Lace canvas by name.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          system: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['name'],
      },
    },
    async (params): Promise<ToolResult> => {
      const name = params.name as string | undefined;
      const system = params.system as string | undefined;
      const requestedVersion = params.version as string | undefined;

      if (!name) {
        return { content: 'Missing required parameter: name', isError: true };
      }

      // Normalize: "ec2 instance" / "ec2_instance" / "ec2-instance" all become "ec2-instance"
      const normalize = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '-');
      const nameNorm = normalize(name);

      const modules = deps.getRegistryModules();
      const systemLower = system?.toLowerCase();

      // 1. Exact normalized match
      let match = modules.find(
        (m) =>
          normalize(m.name) === nameNorm &&
          (!systemLower || m.system.toLowerCase() === systemLower),
      );

      // 2. Fuzzy: input is a substring of module name/id (or vice versa)
      if (!match) {
        const candidates = modules.filter(
          (m) =>
            (normalize(m.name).includes(nameNorm) ||
              normalize(m.id).includes(nameNorm) ||
              nameNorm.includes(normalize(m.name))) &&
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

      // 3. Not in local cache — search across all user orgs via RPC
      //    The user is a member of these orgs, so they have access to private modules.
      let matchOrg: string | undefined;
      if (!match) {
        const client = deps.getRpcClient();
        if (client) {
          try {
            const orgSlugs = deps.getUserOrgs().map((o) => o.slug);
            const orgKeys = ['', ...orgSlugs];
            const searches = orgKeys.map((org) =>
              client
                .listRegistryModules({
                  search: name,
                  system: system || undefined,
                  limit: 10,
                  organization: org,
                })
                .then((r) => ({ org, modules: r?.modules ?? [] }))
                .catch(() => ({ org, modules: [] as RegistryModule[] })),
            );
            const results = await Promise.all(searches);
            for (const { org, modules: mods } of results) {
              const found = mods.find((m) => normalize(m.name) === nameNorm);
              if (found) {
                match = found;
                matchOrg = org;
                break;
              }
            }
            // Fuzzy fallback on RPC results too
            if (!match) {
              for (const { org, modules: mods } of results) {
                const found = mods.find(
                  (m) =>
                    normalize(m.name).includes(nameNorm) || nameNorm.includes(normalize(m.name)),
                );
                if (found) {
                  match = found;
                  matchOrg = org;
                  break;
                }
              }
            }
          } catch {
            // RPC failed — fall through to error
          }
        }
      }

      if (!match) {
        return {
          content: `Module "${name}"${system ? ` (${system})` : ''} not found in the registry. Use lace_search_registry to find available modules.`,
          isError: true,
        };
      }

      const versionToAdd = requestedVersion ?? match.version;

      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;

      try {
        // PlaceModule: single RPC — CLI fetches the bundle, places the module,
        // and handles layout positioning server-side.
        const existingNodes = deps.getCanvasView()?.nodes ?? [];
        const existingIds = new Set(existingNodes.map((n) => n.id));

        const canvasView = await engineResult.client.placeModule({
          name: match.name,
          system: match.system,
          version: versionToAdd,
          organization: matchOrg,
        });

        const newNodes = canvasView.nodes.filter((n) => !existingIds.has(n.id));

        // Find the newly added instance ID — try module_key match first, then new node
        let instanceId =
          canvasView.nodes.find((n) => n.module_key && n.module_key.includes(match!.id))?.id ??
          newNodes[0]?.id;

        // Build response with required inputs so model can set them immediately
        const lines: string[] = [];

        if (instanceId) {
          lines.push(
            `Added **${match.name}** (${match.system}, ${versionToAdd}) to the canvas as instance **"${instanceId}"**.`,
          );
        } else {
          lines.push(
            `Added **${match.name}** (${match.system}, ${versionToAdd}) to the canvas. Use lace_describe_graph to find the instance ID.`,
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
        const msg = errorMessage(err);
        const isVersionNotFound =
          msg.includes('404') || msg.includes('not found') || msg.includes('Not Found');
        const versionHint =
          requestedVersion && isVersionNotFound
            ? ` Version "${versionToAdd}" may not exist. Use lace_inspect_module to check available versions, or omit the version to add the latest.`
            : '';
        return {
          content: `Failed to add module: ${msg}${versionHint}`,
          isError: true,
        };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_remove_module
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_remove_module',
      description: 'Remove a module instance from the canvas by instance ID.',
      inputSchema: {
        type: 'object',
        properties: {
          instance_id: {
            type: 'string',
          },
        },
        required: ['instance_id'],
      },
    },
    async (params): Promise<ToolResult> => {
      const instanceId = params.instance_id as string | undefined;
      if (!instanceId) {
        return { content: 'Missing required parameter: instance_id', isError: true };
      }

      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;

      // Warn about incoming connections that will be severed
      let warnLines: string[] = [];
      try {
        const view = deps.getCanvasView();
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
        await engineResult.client.deleteInstance({ instance_id: instanceId });

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
    },
  );

  // ─────────────────────────────────────────────
  // lace_connect
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_connect',
      description: 'Wire an output from one instance to an input on another.',
      inputSchema: {
        type: 'object',
        properties: {
          source_instance: {
            type: 'string',
          },
          target_instance: {
            type: 'string',
          },
          source_output: {
            type: 'string',
          },
          target_input: {
            type: 'string',
          },
        },
        required: ['source_instance', 'target_instance', 'source_output', 'target_input'],
      },
    },
    async (params): Promise<ToolResult> => {
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
        await engineResult.client.connect({
          source: sourceInstance,
          target: targetInstance,
          source_output: sourceOutput,
          target_input: targetInput,
        });
        return {
          content: `Connected ${sourceInstance}.${sourceOutput} → ${targetInstance}.${targetInput}`,
        };
      } catch (err: unknown) {
        const msg = errorMessage(err);
        const notFound =
          msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('unknown');
        return {
          content: `Failed to connect: ${msg}${notFound ? '\nUse lace_inspect_node on each instance to see exact output/input names. Instance IDs come from the canvas snapshot.' : ''}`,
          isError: true,
        };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_disconnect
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_disconnect',
      description: 'Remove a wire from an input.',
      inputSchema: {
        type: 'object',
        properties: {
          target_instance: {
            type: 'string',
          },
          input_name: {
            type: 'string',
          },
        },
        required: ['target_instance', 'input_name'],
      },
    },
    async (params): Promise<ToolResult> => {
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
        await engineResult.client.disconnect({
          target: targetInstance,
          input_name: inputName,
        });
        return { content: `Disconnected input "${inputName}" on instance "${targetInstance}".` };
      } catch (err: unknown) {
        return { content: `Failed to disconnect: ${errorMessage(err)}`, isError: true };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_set_input
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_set_input',
      description:
        'Set the value of an input. Provide exactly one of: value, variable, expression.',
      inputSchema: {
        type: 'object',
        properties: {
          instance_id: {
            type: 'string',
          },
          input_name: {
            type: 'string',
          },
          value: {},
          variable: {
            type: 'string',
          },
          expression: {
            type: 'string',
          },
        },
        required: ['instance_id', 'input_name'],
      },
    },
    async (params): Promise<ToolResult> => {
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
        await engineResult.client.updateInput({
          instance_id: instanceId,
          input_name: inputName,
          mode,
          value,
          variable,
          expression,
        });

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
    },
  );

  // ─────────────────────────────────────────────
  // lace_rename_instance
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_rename_instance',
      description: 'Rename a module instance.',
      inputSchema: {
        type: 'object',
        properties: {
          old_id: {
            type: 'string',
          },
          new_id: {
            type: 'string',
          },
        },
        required: ['old_id', 'new_id'],
      },
    },
    async (params): Promise<ToolResult> => {
      const oldId = params.old_id as string | undefined;
      const newId = params.new_id as string | undefined;

      if (!oldId || !newId) {
        return {
          content: 'Missing required parameters: old_id, new_id',
          isError: true,
        };
      }

      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;

      try {
        await engineResult.client.renameInstance({ old_id: oldId, new_id: newId });

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
    },
  );

  // ─────────────────────────────────────────────
  // lace_set_variable — add/update a canvas-level variable
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_set_variable',
      description: 'Add or update a canvas-level Terraform variable.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
          type: {
            type: 'string',
          },
          required: {
            type: 'boolean',
          },
          description: {
            type: 'string',
          },
          default: {},
        },
        required: ['name', 'type'],
      },
    },
    async (params): Promise<ToolResult> => {
      const varName = params.name as string | undefined;
      const varType = params.type as string | undefined;

      if (!varName || !varType) {
        return {
          content: 'Missing required parameters: name, type',
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
        await engineResult.client.setVariables({
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

        const reqLabel = required ? 'required' : 'optional';
        const defLabel =
          defaultValue !== undefined ? `, default: ${JSON.stringify(defaultValue)}` : '';
        return {
          content: `Variable \`${varName}\` (${varType}, ${reqLabel}${defLabel}) added to canvas. Use lace_set_input with variable: "${varName}" to bind it to an input.`,
        };
      } catch (err: unknown) {
        return { content: `Failed to set variable: ${errorMessage(err)}`, isError: true };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_undo — undo last canvas change
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_undo',
      description: 'Undo the last change to the canvas.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    async (): Promise<ToolResult> => {
      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;

      try {
        const canvasView = await engineResult.client.undo();
        return {
          content: `Undone. Canvas now has ${canvasView.nodes.length} instance(s) and ${canvasView.edges.length} connection(s).`,
        };
      } catch (err: unknown) {
        return { content: `Failed to undo: ${errorMessage(err)}`, isError: true };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_set_local
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_set_local',
      description: 'Add or update a Terraform local value.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
          value: {},
          expression: {
            type: 'string',
          },
        },
        required: ['name'],
      },
    },
    async (params): Promise<ToolResult> => {
      const name = params.name as string | undefined;
      const value = params.value;
      const expression = params.expression as string | undefined;

      if (!name) {
        return { content: 'Missing required parameter: name', isError: true };
      }

      const hasValue = value !== undefined;
      const hasExpression = typeof expression === 'string';
      if (!hasValue && !hasExpression) {
        return {
          content: 'Must provide exactly one of: value (literal) or expression (HCL expression).',
          isError: true,
        };
      }

      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;
      const client = engineResult.client;

      try {
        // Read existing locals, merge, then write back (setLocals replaces the full array)
        const settings = await client.querySettings();
        const existingLocals = (settings.locals ?? []).filter((l) => l.name !== name);
        const newLocal = {
          name,
          mode: hasExpression ? 'expression' : 'literal',
          value: hasValue ? value : undefined,
          expression: hasExpression ? expression : undefined,
        };
        await client.setLocals({ locals: [...existingLocals, newLocal] });

        const display = hasExpression
          ? `expression \`${expression}\``
          : `value ${JSON.stringify(value)}`;
        return { content: `Set local "${name}" to ${display}.` };
      } catch (err: unknown) {
        return { content: `Failed to set local: ${errorMessage(err)}`, isError: true };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_set_environment
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_set_environment',
      description: 'Define environment-specific variable overrides.',
      inputSchema: {
        type: 'object',
        properties: {
          environment: {
            type: 'string',
          },
          variables: {
            type: 'object',
          },
        },
        required: ['environment', 'variables'],
      },
    },
    async (params): Promise<ToolResult> => {
      const environment = params.environment as string | undefined;
      const variables = params.variables as Record<string, unknown> | undefined;

      if (!environment) {
        return { content: 'Missing required parameter: environment', isError: true };
      }
      if (!variables || typeof variables !== 'object') {
        return {
          content: 'Missing required parameter: variables (object of key-value pairs)',
          isError: true,
        };
      }

      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;
      const client = engineResult.client;

      try {
        // Read existing environments, merge variables into target environment
        const settings = await client.querySettings();
        const existingEnvs = settings.environments ?? {};
        const mergedEnvs = {
          ...existingEnvs,
          [environment]: { ...(existingEnvs[environment] ?? {}), ...variables },
        };
        await client.setEnvironments({ environments: mergedEnvs });

        const keys = Object.keys(variables).join(', ');
        return {
          content: `Set ${Object.keys(variables).length} variable(s) in environment "${environment}": ${keys}.`,
        };
      } catch (err: unknown) {
        return { content: `Failed to set environment: ${errorMessage(err)}`, isError: true };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_create_group
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_create_group',
      description: 'Create a visual group around instances on the canvas.',
      inputSchema: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
          },
          instance_ids: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
        },
        required: ['label', 'instance_ids'],
      },
    },
    async (params): Promise<ToolResult> => {
      const label = params.label as string | undefined;
      const instanceIds = params.instance_ids as string[] | undefined;

      if (!label) {
        return { content: 'Missing required parameter: label', isError: true };
      }
      if (!instanceIds || instanceIds.length < 2) {
        return {
          content: 'Missing required parameter: instance_ids (at least 2 instance IDs)',
          isError: true,
        };
      }

      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;

      try {
        const existingGroupIds = new Set((deps.getCanvasView()?.groups ?? []).map((g) => g.id));
        const canvasView = await engineResult.client.createGroup({
          label,
          node_ids: instanceIds,
        });

        const newGroup = canvasView.groups.find((g) => !existingGroupIds.has(g.id));
        const groupId = newGroup?.id ?? 'unknown';
        return {
          content: `Created group "${label}" (id: ${groupId}) with ${instanceIds.length} instances: ${instanceIds.join(', ')}.`,
        };
      } catch (err: unknown) {
        return { content: `Failed to create group: ${errorMessage(err)}`, isError: true };
      }
    },
  );

  // ─────────────────────────────────────────────
  // lace_ungroup
  // ─────────────────────────────────────────────
  registerTool(
    {
      name: 'lace_ungroup',
      description: 'Remove a visual group. Instances remain on the canvas.',
      inputSchema: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
          },
        },
        required: ['group_id'],
      },
    },
    async (params): Promise<ToolResult> => {
      const groupId = params.group_id as string | undefined;

      if (!groupId) {
        return { content: 'Missing required parameter: group_id', isError: true };
      }

      const engineResult = requireEngine(deps.getRpcClient);
      if ('error' in engineResult) return engineResult.error;

      try {
        await engineResult.client.deleteGroup({ group_id: groupId });
        return { content: `Removed group "${groupId}". All instances remain on the canvas.` };
      } catch (err: unknown) {
        return { content: `Failed to ungroup: ${errorMessage(err)}`, isError: true };
      }
    },
  );
}
