// src/chat/tools/registry-tools.ts
//
// Tool: lace_search_registry — search the module registry.
// Tool: lace_inspect_module — get full input/output schema for a specific module.

import type { LaceClient } from '../../utilities/engine/grpc-client';
import type { RegistryModule } from '../../types/protocol';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';
import { requireEngine, errorMessage } from './helpers';

export type RegistryToolDeps = {
  getRpcClient: () => LaceClient | null;
  getRegistryModules: () => RegistryModule[];
};

const MAX_SEARCH_LIMIT = 50;

function formatModuleLine(m: {
  name: string;
  system: string;
  version: string;
  categories?: string[];
  description?: string;
}): string {
  const cats = m.categories?.length ? ` [${m.categories.join(', ')}]` : '';
  const desc = m.description ? ` — ${m.description}` : '';
  return `- **${m.name}** (${m.system}, v${m.version})${cats}${desc}`;
}

export function registerRegistryTools(deps: RegistryToolDeps): void {
  registerTool('lace_search_registry', async (params): Promise<ToolResult> => {
    const query = (params.query as string | undefined) ?? '';
    const system = params.system as string | undefined;
    const category = params.category as string | undefined;
    const rawLimit = (params.limit as number | undefined) ?? 20;
    const limit = Math.min(rawLimit, MAX_SEARCH_LIMIT);

    // Try RPC search first (more accurate, server-side filtering)
    const client = deps.getRpcClient();
    if (client) {
      try {
        const result = await client.listRegistryModules({
          search: query || undefined,
          system: system || undefined,
          category: category || undefined,
          limit,
        });

        const modules = result?.modules ?? [];
        if (modules.length === 0) {
          return {
            content: `No modules found matching your search. Try broader terms, remove the system filter, or check that the Lace engine is running and authenticated.`,
          };
        }

        const lines = modules.map(formatModuleLine);
        const limitNote = rawLimit > MAX_SEARCH_LIMIT ? ` (showing top ${MAX_SEARCH_LIMIT})` : '';
        return { content: `Found ${modules.length} module(s)${limitNote}:\n\n${lines.join('\n')}` };
      } catch {
        // Fall through to local search — note the fallback
      }
    }

    // Fallback: search locally cached modules (may be stale)
    let modules = deps.getRegistryModules();
    if (query) {
      const q = query.toLowerCase();
      modules = modules.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q) ||
          m.categories?.some((c) => c.toLowerCase().includes(q)),
      );
    }
    if (system) {
      modules = modules.filter((m) => m.system.toLowerCase() === system.toLowerCase());
    }
    if (category) {
      const cat = category.toLowerCase();
      modules = modules.filter((m) => m.categories?.some((c) => c.toLowerCase() === cat));
    }
    modules = modules.slice(0, limit);

    if (modules.length === 0) {
      return {
        content: `No modules found matching your search. Try broader terms, remove the system filter, or check that the Lace engine is running and authenticated.`,
      };
    }

    const lines = modules.map(formatModuleLine);
    return {
      content: `⚠ Showing cached registry (engine not reachable). Results may be stale.\n\nFound ${modules.length} module(s):\n\n${lines.join('\n')}`,
    };
  });

  // ─────────────────────────────────────────────
  // lace_inspect_module
  // ─────────────────────────────────────────────
  registerTool('lace_inspect_module', async (params): Promise<ToolResult> => {
    const name = params.name as string | undefined;
    const system = params.system as string | undefined;
    const version = params.version as string | undefined;

    if (!name) {
      return { content: 'Missing required parameter: name', isError: true };
    }

    // Guard: if the name has no "/" and is a plain Terraform identifier (letters/digits/underscores only,
    // no hyphens, not a known cloud system name), it is likely a canvas instance ID not a module name.
    // Instance IDs: "vpc", "subnet_1", "my_cluster"
    // Registry modules: "aws/vpc", "azure/resource-group" (always contain "/")
    // Allow: "aws", "azure", "gcp" (system names used for fuzzy search)
    const knownSystems = new Set(['aws', 'azure', 'gcp', 'google', 'kubernetes', 'k8s']);
    const looksLikeInstanceId =
      !name.includes('/') &&
      !name.includes('-') &&
      !knownSystems.has(name.toLowerCase()) &&
      /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) &&
      name.length < 30;

    if (looksLikeInstanceId) {
      return {
        content: `"${name}" looks like a canvas instance ID, not a registry module name. Use lace_inspect_node with instance_id="${name}" to inspect a placed instance. Registry module names follow the pattern "system/name" (e.g., "aws/vpc"). Use lace_search_registry to find module names.`,
        isError: true,
      };
    }

    // Find the module in local cache first to get system/version
    const modules = deps.getRegistryModules();
    const nameLower = name.toLowerCase();
    const systemLower = system?.toLowerCase();

    let match = modules.find(
      (m) =>
        m.name.toLowerCase() === nameLower &&
        (!systemLower || m.system.toLowerCase() === systemLower) &&
        (!version || m.version === version),
    );

    if (!match) {
      // Fuzzy match
      const candidates = modules.filter(
        (m) =>
          (m.name.toLowerCase().includes(nameLower) || m.id.toLowerCase().includes(nameLower)) &&
          (!systemLower || m.system.toLowerCase() === systemLower),
      );
      if (candidates.length === 1) {
        match = candidates[0];
      } else if (candidates.length > 1) {
        const names = candidates.slice(0, 5).map((m) => `${m.name} (${m.system}, v${m.version})`);
        return {
          content: `Multiple modules match "${name}". Please be more specific:\n${names.join('\n')}`,
          isError: true,
        };
      }
    }

    if (!match) {
      return {
        content: `Module "${name}" not found in the registry.`,
        isError: true,
      };
    }

    // Fetch full module details via RPC
    const engineResult = requireEngine(deps.getRpcClient);
    if ('error' in engineResult) {
      // Return basic info from local cache
      return {
        content: `**${match.name}** (${match.system}, v${match.version})\n${match.description ?? 'No description.'}\n\n_Lace engine not running — cannot fetch full interface schema._`,
      };
    }
    const client = engineResult.client;

    try {
      const versionResponse = await client.getRegistryVersion({
        name: match.name,
        system: match.system,
        version: match.version,
      });

      if (!versionResponse?.deploy_bundle && !versionResponse?.module_interface) {
        return {
          content: `**${match.name}** (${match.system}, v${match.version})\nModule found but schema not available. Add the module to the canvas with lace_add_module, then use lace_inspect_node to see its inputs/outputs.`,
        };
      }

      const lines: string[] = [];
      lines.push(`**${match.name}** (${match.system}, v${match.version})`);
      if (match.description) lines.push(match.description);
      lines.push('');

      if (versionResponse.module_interface) {
        const inputs = versionResponse.module_interface.inputs ?? [];
        const outputs = versionResponse.module_interface.outputs ?? [];

        if (inputs.length > 0) {
          lines.push('### Inputs');
          for (const inp of inputs) {
            const req = inp.required ? ' **(required)**' : '';
            const def =
              inp.default_value !== undefined
                ? ` (default: ${JSON.stringify(inp.default_value)})`
                : '';
            const desc = inp.description ? ` — ${inp.description}` : '';
            lines.push(`- \`${inp.name}\` (${inp.type})${req}${def}${desc}`);
          }
        } else {
          lines.push('### Inputs: none');
        }

        lines.push('');

        if (outputs.length > 0) {
          lines.push('### Outputs');
          for (const out of outputs) {
            const desc = out.description ? ` — ${out.description}` : '';
            lines.push(`- \`${out.name}\` (${out.type})${desc}`);
          }
        } else {
          lines.push('### Outputs: none');
        }
      }

      return { content: lines.join('\n') };
    } catch (err: unknown) {
      return {
        content: `Failed to inspect module: ${errorMessage(err)}`,
        isError: true,
      };
    }
  });
}
