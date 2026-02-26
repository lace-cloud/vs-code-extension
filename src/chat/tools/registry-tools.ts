// src/chat/tools/registry-tools.ts
//
// Tool: lace_search_registry — search the module registry.

import type { JSONRPCClient } from '../../utilities/engine/rpc-client';
import type { RegistryModule } from '../../types/protocol';
import type { ToolResult } from '../types';
import { registerTool } from '../tool-registry';

export type RegistryToolDeps = {
  getRpcClient: () => JSONRPCClient | null;
  getRegistryModules: () => RegistryModule[];
};

export function registerRegistryTools(deps: RegistryToolDeps): void {
  registerTool('lace_search_registry', async (params): Promise<ToolResult> => {
    const query = (params.query as string | undefined) ?? '';
    const system = params.system as string | undefined;
    const category = params.category as string | undefined;
    const limit = (params.limit as number | undefined) ?? 20;

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
          return { content: 'No modules found matching your search.' };
        }

        const lines = modules.map((m: any) => {
          const cats = m.categories?.length ? ` [${m.categories.join(', ')}]` : '';
          const desc = m.description ? ` — ${m.description}` : '';
          return `- **${m.name}** (${m.system}, v${m.version})${cats}${desc}`;
        });

        return { content: `Found ${modules.length} module(s):\n\n${lines.join('\n')}` };
      } catch (err: any) {
        // Fall through to local search
      }
    }

    // Fallback: search locally cached modules
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
      return { content: 'No modules found matching your search.' };
    }

    const lines = modules.map((m) => {
      const cats = m.categories?.length ? ` [${m.categories.join(', ')}]` : '';
      const desc = m.description ? ` — ${m.description}` : '';
      return `- **${m.name}** (${m.system}, v${m.version})${cats}${desc}`;
    });

    return { content: `Found ${modules.length} module(s):\n\n${lines.join('\n')}` };
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
    const client = deps.getRpcClient();
    if (!client) {
      // Return basic info from local cache
      return {
        content: `**${match.name}** (${match.system}, v${match.version})\n${match.description ?? 'No description.'}\n\n_Lace engine not running — cannot fetch full interface schema._`,
      };
    }

    try {
      const versionResponse = await client.getRegistryVersion({
        name: match.name,
        system: match.system,
        version: match.version,
      });

      const deployBundle = versionResponse?.deploy_bundle;
      if (!deployBundle) {
        return {
          content: `**${match.name}** (${match.system}, v${match.version})\nNo deploy bundle available.`,
        };
      }

      // Extract the entry module's interface from the deploy bundle
      const entryKey = `${deployBundle.entry.module_id}@${deployBundle.entry.version}`;
      const entryDef = deployBundle.modules?.[entryKey];

      const lines: string[] = [];
      lines.push(`**${match.name}** (${match.system}, v${match.version})`);
      if (match.description) lines.push(match.description);
      lines.push('');

      if (entryDef?.interface) {
        const inputs = entryDef.interface.inputs ?? [];
        const outputs = entryDef.interface.outputs ?? [];

        if (inputs.length > 0) {
          lines.push('### Inputs');
          for (const inp of inputs) {
            const req = inp.required ? ' **(required)**' : '';
            const def =
              inp.default !== undefined ? ` (default: ${JSON.stringify(inp.default)})` : '';
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
    } catch (err: any) {
      return {
        content: `Failed to inspect module: ${err.message}`,
        isError: true,
      };
    }
  });
}
