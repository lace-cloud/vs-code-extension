import type { Instance, ModuleDef, InputDef, OutputDef } from '../types/ir';
import { isModuleInstance } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';

export type ResolvedSchema = { inputs: InputDef[]; outputs: OutputDef[] };
const EMPTY_SCHEMA: ResolvedSchema = { inputs: [], outputs: [] };

export function resolveModuleDef(workspace: WorkspaceState, inst: Instance): ModuleDef | undefined {
  if (!isModuleInstance(inst)) {
    return undefined;
  }
  const exactKey = `${inst.use.module_id}@${inst.use.version}`;
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

export function resolveNodeType(workspace: WorkspaceState, inst: Instance): string {
  if (!isModuleInstance(inst)) {
    return 'moduleNode';
  }
  const def = resolveModuleDef(workspace, inst);
  if (def?.impl.kind === 'composite') {
    return 'compositeNode';
  }
  return 'moduleNode';
}
