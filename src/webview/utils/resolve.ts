import type { Instance, ModuleDef, InputDef, OutputDef } from '../types/ir';
import { isModuleInstance } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';
import { makeModuleKey } from './identifiers';

export type ResolvedSchema = { inputs: InputDef[]; outputs: OutputDef[] };
const EMPTY_SCHEMA: ResolvedSchema = { inputs: [], outputs: [] };

export function resolveModuleDef(workspace: WorkspaceState, inst: Instance): ModuleDef | undefined {
  if (!isModuleInstance(inst)) {
    return undefined;
  }
  const exactKey = makeModuleKey(inst.use.module_id, inst.use.version);
  if (workspace.modules[exactKey]) {
    return workspace.modules[exactKey];
  }
  return Object.values(workspace.modules).find((m) => m.id === inst.use.module_id);
}

export function resolveSchema(workspace: WorkspaceState, inst: Instance): ResolvedSchema {
  const def = resolveModuleDef(workspace, inst);
  if (!def) {
    return EMPTY_SCHEMA;
  }
  return { inputs: def.interface.inputs, outputs: def.interface.outputs };
}

/**
 * Resolve the icon URL for an instance from an icon map.
 * The icon map is keyed by module_key ("id@version").
 * Returns undefined for non-module instances or missing entries.
 */
export function resolveIconUrl(
  inst: Instance,
  iconMap: Record<string, string>,
): string | undefined {
  if (!isModuleInstance(inst)) return undefined;
  const key = makeModuleKey(inst.use.module_id, inst.use.version);
  return iconMap[key];
}
