import type { Use, Resource, Module, InputDef, OutputDef } from '../types/ir';
import { isUse } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';

export type ResolvedSchema = { inputs: InputDef[]; outputs: OutputDef[] };
const EMPTY_SCHEMA: ResolvedSchema = { inputs: [], outputs: [] };

export function resolveModuleDef(
  workspace: WorkspaceState,
  child: Use | Resource,
): Module | undefined {
  if (!isUse(child)) {
    return undefined;
  }
  return workspace.modules[child.module];
}

export function resolveSchema(workspace: WorkspaceState, child: Use | Resource): ResolvedSchema {
  const def = resolveModuleDef(workspace, child);
  if (!def) {
    return EMPTY_SCHEMA;
  }
  return { inputs: def.interface.inputs, outputs: def.interface.outputs };
}

/**
 * Resolve the icon URL for a child from an icon map.
 * The icon map is keyed by module_key ("id@version").
 * Returns undefined for non-Use children or missing entries.
 */
export function resolveIconUrl(
  child: Use | Resource,
  iconMap: Record<string, string>,
): string | undefined {
  if (!isUse(child)) return undefined;
  return iconMap[child.module];
}
