import type {
  Binding,
  OutputExport,
  InputDef,
  OutputDef,
  TerraformBlock,
  ProviderConfig,
  LocalDef,
  Bundle,
  Module,
  Use,
  Resource,
} from '../types/ir';
import { isOut, isVar, isOutExport } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';
import { uniqueInstanceId, depBareId } from '../utils/identifiers';
import { computeLayout, fromBundle } from '../utils/bundle';
import { allChildren } from '../utils/children';

// ══════════════════════════════════════════════════════════════════════
// WorkspaceAction — full type union (all phases)
// ══════════════════════════════════════════════════════════════════════

export type WorkspaceAction =
  // ── Core editing ──
  | {
      type: 'DROP_BUNDLE';
      module_key: string;
      deploy_bundle: Bundle;
      positions: Record<string, { x: number; y: number }>;
    }
  | {
      type: 'CONNECT';
      module_key: string;
      source_instance: string;
      target_instance: string;
      mapping: { from: string; to: string };
    }
  | { type: 'DISCONNECT'; module_key: string; target_instance: string; input_name: string }
  | {
      type: 'UPDATE_INPUTS';
      module_key: string;
      instance_id: string;
      inputs: Record<string, Binding>;
    }
  | { type: 'RENAME_INSTANCE'; module_key: string; old_id: string; new_id: string }
  | { type: 'DELETE_INSTANCE'; module_key: string; instance_id: string }
  | {
      type: 'SYNC_LAYOUT';
      module_key: string;
      positions: Record<string, { x: number; y: number }>;
    }
  | { type: 'LOAD_WORKSPACE'; workspace: WorkspaceState }
  // ── Composite interface ──
  | { type: 'SET_VARIABLES'; module_key: string; variables: InputDef[] }
  | {
      type: 'SET_EXPORTS';
      module_key: string;
      outputs: Record<string, OutputExport>;
      output_defs: OutputDef[];
    }
  // ── Terraform config ──
  | { type: 'SET_TERRAFORM'; module_key: string; terraform: TerraformBlock }
  | { type: 'SET_PROVIDERS'; module_key: string; providers: ProviderConfig[] }
  | { type: 'SET_LOCALS'; module_key: string; locals: LocalDef[] }
  | { type: 'SET_DEPENDS_ON'; module_key: string; instance_id: string; depends_on: string[] }
  | { type: 'SET_ENVIRONMENTS'; environments: WorkspaceState['environments'] }
  | { type: 'SET_ENVIRONMENT_BACKENDS'; backends: WorkspaceState['environment_backends'] }
  // ── Graph management ──
  | { type: 'CLEAR_GRAPH'; module_key: string }
  // ── Refresh ──
  | { type: 'REFRESH_MODULE_DEFS'; updated_modules: Record<string, Module> };

// ══════════════════════════════════════════════════════════════════════
// updateModule helper
// ══════════════════════════════════════════════════════════════════════

function updateModule(
  state: WorkspaceState,
  module_key: string,
  fn: (mod: Module) => Module,
): WorkspaceState {
  const def = state.modules[module_key];
  if (!def) {
    return state;
  }
  return {
    ...state,
    modules: {
      ...state.modules,
      [module_key]: fn(def),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// mapChildById — update a specific child by ID in either modules[] or resources[]
// ══════════════════════════════════════════════════════════════════════

function mapChildById(
  mod: Module,
  id: string,
  fnUse: (u: Use) => Use,
  fnResource: (r: Resource) => Resource,
): Module {
  return {
    ...mod,
    modules: mod.modules?.map((u) => (u.id === id ? fnUse(u) : u)),
    resources: mod.resources?.map((r) => (r.id === id ? fnResource(r) : r)),
  };
}

// ══════════════════════════════════════════════════════════════════════
// depends_on helpers (entries may be "module.X" or bare "X")
// ══════════════════════════════════════════════════════════════════════

function depMatchesInstance(dep: string, instanceId: string): boolean {
  return dep === instanceId || dep === `module.${instanceId}`;
}

function depRenameInstance(dep: string, oldId: string, newId: string): string {
  if (dep === `module.${oldId}`) return `module.${newId}`;
  if (dep === oldId) return newId;
  return dep;
}

// ══════════════════════════════════════════════════════════════════════
// Binding / depends_on transform helpers
// ══════════════════════════════════════════════════════════════════════

/** Transform each binding in an input map. Return undefined from fn to remove the entry. */
function mapBindings(
  inputs: Record<string, Binding>,
  fn: (binding: Binding, name: string) => Binding | undefined,
): Record<string, Binding> {
  const result: Record<string, Binding> = {};
  for (const [name, binding] of Object.entries(inputs)) {
    const mapped = fn(binding, name);
    if (mapped !== undefined) {
      result[name] = mapped;
    }
  }
  return result;
}

/** Normalize depends_on: empty/undefined → omit. */
function normalizeDependsOn(deps: string[] | undefined): { depends_on: string[] } | {} {
  return deps && deps.length > 0 ? { depends_on: deps } : {};
}

// ══════════════════════════════════════════════════════════════════════
// workspaceReducer
// ══════════════════════════════════════════════════════════════════════

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    // ── Core editing ──
    case 'DROP_BUNDLE':
      return handleDropBundle(state, action);
    case 'CONNECT':
      return handleConnect(state, action);
    case 'DISCONNECT':
      return handleDisconnect(state, action);
    case 'UPDATE_INPUTS':
      return handleUpdateInputs(state, action);
    case 'RENAME_INSTANCE':
      return handleRenameInstance(state, action);
    case 'DELETE_INSTANCE':
      return handleDeleteInstance(state, action);
    case 'SYNC_LAYOUT':
      return handleSyncLayout(state, action);
    case 'LOAD_WORKSPACE':
      return gcOrphanedModules(action.workspace);
    case 'CLEAR_GRAPH':
      return handleClearGraph(state, action);

    // ── Composite interface ──
    case 'SET_VARIABLES':
      return handleSetVariables(state, action);
    case 'SET_EXPORTS':
      return handleSetExports(state, action);

    // ── Terraform config ──
    case 'SET_TERRAFORM':
      return handleSetTerraform(state, action);
    case 'SET_PROVIDERS':
      return handleSetProviders(state, action);
    case 'SET_LOCALS':
      return handleSetLocals(state, action);
    case 'SET_DEPENDS_ON':
      return handleSetDependsOn(state, action);
    case 'SET_ENVIRONMENTS':
      return handleSetEnvironments(state, action);
    case 'SET_ENVIRONMENT_BACKENDS':
      return handleSetEnvironmentBackends(state, action);

    // ── Refresh ──
    case 'REFRESH_MODULE_DEFS':
      return handleRefreshModuleDefs(state, action);
  }
}

// ══════════════════════════════════════════════════════════════════════
// DROP_BUNDLE
// ══════════════════════════════════════════════════════════════════════

/**
 * Recursively flatten a module's children to leaf children.
 *
 * For each Use child in a module:
 * - If it references a leaf module (no sub-children) → keep it as-is.
 * - If it references a composite module → replace it with that composite's
 *   (recursively flattened) children, resolving bindings through the
 *   composite's interface (inputs via instance bindings, outputs via exports).
 */
function flattenChildren(
  mod: Module,
  allModules: Record<string, Module>,
): { uses: Use[]; resources: Resource[] } {
  const uses: Use[] = [];
  const resources: Resource[] = [];

  // Process resources (always leaves)
  for (const r of mod.resources ?? []) {
    resources.push(r);
  }

  // Process module uses
  for (const use of mod.modules ?? []) {
    const def = allModules[use.module];

    const children = def ? allChildren(def) : [];
    if (!def || children.length === 0) {
      // Leaf-like (no sub-children) or unresolved — keep as-is
      uses.push(use);
      continue;
    }

    // Has sub-children — unpack recursively
    const { uses: subUses, resources: subResources } = flattenChildren(def, allModules);

    for (const subUse of subUses) {
      const resolvedInputs = resolveChildBindings(subUse.inputs, use.inputs);
      uses.push({
        ...subUse,
        ...(Object.keys(resolvedInputs).length > 0 ? { inputs: resolvedInputs } : {}),
      });
    }

    for (const subRes of subResources) {
      const resolvedInputs = resolveChildBindings(subRes.inputs, use.inputs);
      resources.push({
        ...subRes,
        ...(Object.keys(resolvedInputs).length > 0 ? { inputs: resolvedInputs } : {}),
      });
    }
  }

  return { uses, resources };
}

/** Resolve a child's bindings through a parent composite's input map. */
function resolveChildBindings(
  childInputs: Record<string, Binding> | undefined,
  parentInputs: Record<string, Binding> | undefined,
): Record<string, Binding> {
  if (!childInputs) return {};
  const resolved: Record<string, Binding> = {};

  for (const [inputName, binding] of Object.entries(childInputs)) {
    if (isVar(binding) && parentInputs) {
      const parentBinding = parentInputs[binding.var];
      if (parentBinding) {
        resolved[inputName] = parentBinding;
      } else {
        resolved[inputName] = binding;
      }
    } else {
      resolved[inputName] = binding;
    }
  }

  return resolved;
}

/** Deduplicate child IDs against existing ones and cascade renames through bindings. */
function resolveIdCollisions(
  uses: Use[],
  resources: Resource[],
  existingIds: Set<string>,
): { uses: Use[]; resources: Resource[]; renameMap: Map<string, string> } {
  const renameMap = new Map<string, string>();
  const ids = new Set(existingIds);

  // Build rename map
  for (const u of uses) {
    const newId = uniqueInstanceId(u.id, ids);
    if (newId !== u.id) renameMap.set(u.id, newId);
    ids.add(newId);
  }
  for (const r of resources) {
    const newId = uniqueInstanceId(r.id, ids);
    if (newId !== r.id) renameMap.set(r.id, newId);
    ids.add(newId);
  }

  if (renameMap.size === 0) {
    return { uses, resources, renameMap };
  }

  const renameChild = <T extends Use | Resource>(child: T): T => {
    const newId = renameMap.get(child.id) ?? child.id;
    const newInputs = child.inputs
      ? mapBindings(child.inputs, (binding) => {
          if (isOut(binding) && renameMap.has(binding.out.module)) {
            return { out: { module: renameMap.get(binding.out.module)!, name: binding.out.name } };
          }
          return binding;
        })
      : undefined;

    const newDependsOn = child.depends_on?.map((dep) => {
      const bare = depBareId(dep);
      const renamed = renameMap.get(bare);
      if (renamed) return dep.startsWith('module.') ? `module.${renamed}` : renamed;
      return dep;
    });

    return {
      ...child,
      id: newId,
      ...(newInputs ? { inputs: newInputs } : {}),
      ...normalizeDependsOn(newDependsOn),
    } as T;
  };

  return {
    uses: uses.map(renameChild),
    resources: resources.map(renameChild),
    renameMap,
  };
}

function handleDropBundle(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'DROP_BUNDLE' }>,
): WorkspaceState {
  const { module_key, positions } = action;
  // Normalize deploy bundle (handles legacy entry/graph formats)
  const { workspace: normalized } = fromBundle(action.deploy_bundle);
  const entryKey = normalized.entry;
  const entryDef = normalized.modules[entryKey];

  if (!entryDef) {
    return state;
  }

  // 1. Merge all non-entry Module entries into workspace.modules (leaf defs needed for resolution)
  const mergedModules = { ...state.modules };
  for (const [key, def] of Object.entries(normalized.modules)) {
    if (key !== entryKey) {
      mergedModules[key] = def;
    }
  }

  // 2. Get existing child IDs in the target module
  const targetDef = state.modules[module_key];
  if (!targetDef) {
    return state;
  }

  const existingUses = [...(targetDef.modules ?? [])];
  const existingResources = [...(targetDef.resources ?? [])];
  const existingIds = new Set([
    ...existingUses.map((u) => u.id),
    ...existingResources.map((r) => r.id),
  ]);

  // 3. Flatten: recursively unpack composite uses to leaves
  const allModulesForResolution = { ...mergedModules, ...normalized.modules };
  const { uses: flatUses, resources: flatResources } = flattenChildren(
    entryDef,
    allModulesForResolution,
  );

  // 4. Handle ID collisions and apply renames
  const {
    uses: newUses,
    resources: newResources,
    renameMap,
  } = resolveIdCollisions(flatUses, flatResources, existingIds);

  // 5. Add layout entries from positions
  const existingLayout = state.layouts[module_key] || { nodes: {} };
  const allNew = [...newUses, ...newResources];
  const positionHints: Record<string, { x: number; y: number }> = {};
  for (const child of allNew) {
    const originalId = [...renameMap.entries()].find(([, v]) => v === child.id)?.[0] ?? child.id;
    if (positions[originalId]) {
      positionHints[child.id] = positions[originalId];
    } else if (positions[child.id]) {
      positionHints[child.id] = positions[child.id];
    }
  }
  const dropLayout = computeLayout(allNew, positionHints);
  const newLayoutNodes = { ...existingLayout.nodes, ...dropLayout.nodes };

  // 6. Build new state
  const updatedUses = [...existingUses, ...newUses];
  const updatedResources = [...existingResources, ...newResources];

  return {
    ...state,
    modules: {
      ...mergedModules,
      [module_key]: {
        ...targetDef,
        ...(updatedUses.length > 0 ? { modules: updatedUses } : { modules: undefined }),
        ...(updatedResources.length > 0
          ? { resources: updatedResources }
          : { resources: undefined }),
      },
    },
    layouts: {
      ...state.layouts,
      [module_key]: { nodes: newLayoutNodes },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// CONNECT
// ══════════════════════════════════════════════════════════════════════

function handleConnect(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'CONNECT' }>,
): WorkspaceState {
  const { module_key, source_instance, target_instance, mapping } = action;
  const setBinding = <T extends Use | Resource>(child: T): T =>
    ({
      ...child,
      inputs: {
        ...(child.inputs ?? {}),
        [mapping.to]: { out: { module: source_instance, name: mapping.from } },
      },
    }) as T;

  return updateModule(state, module_key, (mod) =>
    mapChildById(mod, target_instance, setBinding, setBinding),
  );
}

// ══════════════════════════════════════════════════════════════════════
// DISCONNECT
// ══════════════════════════════════════════════════════════════════════

function handleDisconnect(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'DISCONNECT' }>,
): WorkspaceState {
  const { module_key, target_instance, input_name } = action;
  const removeBinding = <T extends Use | Resource>(child: T): T => {
    if (!child.inputs) return child;
    const { [input_name]: _removed, ...restInputs } = child.inputs;
    return { ...child, inputs: restInputs } as T;
  };

  return updateModule(state, module_key, (mod) =>
    mapChildById(mod, target_instance, removeBinding, removeBinding),
  );
}

// ══════════════════════════════════════════════════════════════════════
// UPDATE_INPUTS
// ══════════════════════════════════════════════════════════════════════

function handleUpdateInputs(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'UPDATE_INPUTS' }>,
): WorkspaceState {
  const { module_key, instance_id, inputs } = action;
  const setInputs = <T extends Use | Resource>(child: T): T => ({ ...child, inputs }) as T;

  return updateModule(state, module_key, (mod) =>
    mapChildById(mod, instance_id, setInputs, setInputs),
  );
}

// ══════════════════════════════════════════════════════════════════════
// RENAME_INSTANCE
// ══════════════════════════════════════════════════════════════════════

function handleRenameInstance(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'RENAME_INSTANCE' }>,
): WorkspaceState {
  const { module_key, old_id, new_id } = action;

  const renameChild = <T extends Use | Resource>(child: T): T => {
    const updatedId = child.id === old_id ? new_id : child.id;
    const updatedInputs = child.inputs
      ? mapBindings(child.inputs, (binding) => {
          if (isOut(binding) && binding.out.module === old_id) {
            return { out: { module: new_id, name: binding.out.name } };
          }
          return binding;
        })
      : undefined;
    const updatedDependsOn = child.depends_on?.map((dep) => depRenameInstance(dep, old_id, new_id));
    return {
      ...child,
      id: updatedId,
      ...(updatedInputs !== undefined ? { inputs: updatedInputs } : {}),
      ...normalizeDependsOn(updatedDependsOn),
    } as T;
  };

  // Update module
  const newState = updateModule(state, module_key, (mod) => ({
    ...mod,
    modules: mod.modules?.map(renameChild),
    resources: mod.resources?.map(renameChild),
    exports: {
      outputs: Object.fromEntries(
        Object.entries(mod.exports.outputs).map(([name, exp]) => {
          if (isOutExport(exp) && exp.out.module === old_id) {
            return [name, { out: { module: new_id, name: exp.out.name } }];
          }
          return [name, exp];
        }),
      ),
    },
  }));

  // Update layout key
  const layout = newState.layouts[module_key];
  if (layout && layout.nodes[old_id]) {
    const { [old_id]: oldNode, ...restNodes } = layout.nodes;
    return {
      ...newState,
      layouts: {
        ...newState.layouts,
        [module_key]: { nodes: { ...restNodes, [new_id]: oldNode } },
      },
    };
  }

  return newState;
}

// ══════════════════════════════════════════════════════════════════════
// collectReachableModuleKeys — traverse from entry to find all referenced defs
// ══════════════════════════════════════════════════════════════════════

function collectReachableModuleKeys(
  modules: Record<string, Module>,
  entryKey: string,
): Set<string> {
  const reachable = new Set<string>();
  const queue = [entryKey];

  while (queue.length > 0) {
    const key = queue.pop()!;
    if (reachable.has(key)) continue;
    reachable.add(key);

    const def = modules[key];
    if (!def) continue;

    for (const use of def.modules ?? []) {
      if (!reachable.has(use.module)) {
        queue.push(use.module);
      }
    }
  }

  return reachable;
}

/** Remove module defs not reachable from the entry module. */
function gcOrphanedModules(state: WorkspaceState): WorkspaceState {
  const entryKey = state.entry;
  const reachable = collectReachableModuleKeys(state.modules, entryKey);

  const moduleKeys = Object.keys(state.modules);
  if (moduleKeys.every((k) => reachable.has(k))) {
    return state; // nothing to collect
  }

  const cleanedModules: Record<string, Module> = {};
  for (const [key, def] of Object.entries(state.modules)) {
    if (reachable.has(key)) {
      cleanedModules[key] = def;
    }
  }
  return { ...state, modules: cleanedModules };
}

// ══════════════════════════════════════════════════════════════════════
// DELETE_INSTANCE
// ══════════════════════════════════════════════════════════════════════

function handleDeleteInstance(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'DELETE_INSTANCE' }>,
): WorkspaceState {
  const { module_key, instance_id } = action;

  const cleanChild = <T extends Use | Resource>(child: T): T => {
    const cleanedInputs = child.inputs
      ? mapBindings(child.inputs, (binding) => {
          if (isOut(binding) && binding.out.module === instance_id) {
            return undefined;
          }
          return binding;
        })
      : undefined;

    const cleanedDependsOn = child.depends_on?.filter(
      (dep) => !depMatchesInstance(dep, instance_id),
    );

    const { depends_on: _deps, ...rest } = child;
    return {
      ...rest,
      ...(cleanedInputs !== undefined ? { inputs: cleanedInputs } : {}),
      ...normalizeDependsOn(cleanedDependsOn),
    } as T;
  };

  const newState = updateModule(state, module_key, (mod) => {
    const newModules = mod.modules?.filter((u) => u.id !== instance_id).map(cleanChild);
    const newResources = mod.resources?.filter((r) => r.id !== instance_id).map(cleanChild);

    return {
      ...mod,
      modules: newModules && newModules.length > 0 ? newModules : undefined,
      resources: newResources && newResources.length > 0 ? newResources : undefined,
      exports: {
        outputs: Object.fromEntries(
          Object.entries(mod.exports.outputs).filter(([, exp]) => {
            if (isOutExport(exp) && exp.out.module === instance_id) {
              return false;
            }
            return true;
          }),
        ),
      },
    };
  });

  // Remove from layout
  const layout = newState.layouts[module_key];
  if (layout && layout.nodes[instance_id]) {
    const { [instance_id]: _removed, ...restNodes } = layout.nodes;
    return gcOrphanedModules({
      ...newState,
      layouts: {
        ...newState.layouts,
        [module_key]: { nodes: restNodes },
      },
    });
  }

  return gcOrphanedModules(newState);
}

// ══════════════════════════════════════════════════════════════════════
// CLEAR_GRAPH
// ══════════════════════════════════════════════════════════════════════

function handleClearGraph(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'CLEAR_GRAPH' }>,
): WorkspaceState {
  const { module_key } = action;
  const def = state.modules[module_key];
  if (!def) return state;

  const clearedState = updateModule(state, module_key, (mod) => ({
    ...mod,
    modules: undefined,
    resources: undefined,
    exports: { outputs: {} },
    locals: undefined,
  }));

  // Clear layout for this module
  const { [module_key]: _removed, ...restLayouts } = clearedState.layouts;

  return gcOrphanedModules({
    ...clearedState,
    layouts: { ...restLayouts, [module_key]: { nodes: {} } },
  });
}

// ══════════════════════════════════════════════════════════════════════
// SYNC_LAYOUT
// ══════════════════════════════════════════════════════════════════════

function handleSyncLayout(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SYNC_LAYOUT' }>,
): WorkspaceState {
  const { module_key, positions } = action;
  const existing = state.layouts[module_key]?.nodes ?? {};
  const updates: Record<string, { position: { x: number; y: number } }> = {};
  for (const [id, pos] of Object.entries(positions)) {
    updates[id] = { position: pos };
  }
  return {
    ...state,
    layouts: {
      ...state.layouts,
      [module_key]: { nodes: { ...existing, ...updates } },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// SET_VARIABLES
// ══════════════════════════════════════════════════════════════════════

function handleSetVariables(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_VARIABLES' }>,
): WorkspaceState {
  const { module_key, variables } = action;
  const def = state.modules[module_key];
  if (!def) return state;
  return {
    ...state,
    modules: {
      ...state.modules,
      [module_key]: {
        ...def,
        interface: { ...def.interface, inputs: variables },
      },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// SET_EXPORTS
// ══════════════════════════════════════════════════════════════════════

function handleSetExports(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_EXPORTS' }>,
): WorkspaceState {
  const { module_key, outputs, output_defs } = action;
  return updateModule(state, module_key, (mod) => ({
    ...mod,
    interface: { ...mod.interface, outputs: output_defs },
    exports: { outputs },
  }));
}

// ══════════════════════════════════════════════════════════════════════
// SET_TERRAFORM
// ══════════════════════════════════════════════════════════════════════

function handleSetTerraform(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_TERRAFORM' }>,
): WorkspaceState {
  const { module_key, terraform } = action;
  const def = state.modules[module_key];
  if (!def) return state;
  return {
    ...state,
    modules: { ...state.modules, [module_key]: { ...def, terraform } },
  };
}

// ══════════════════════════════════════════════════════════════════════
// SET_PROVIDERS
// ══════════════════════════════════════════════════════════════════════

function handleSetProviders(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_PROVIDERS' }>,
): WorkspaceState {
  const { module_key, providers } = action;
  const def = state.modules[module_key];
  if (!def) return state;
  return {
    ...state,
    modules: { ...state.modules, [module_key]: { ...def, providers } },
  };
}

// ══════════════════════════════════════════════════════════════════════
// SET_LOCALS
// ══════════════════════════════════════════════════════════════════════

function handleSetLocals(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_LOCALS' }>,
): WorkspaceState {
  const { module_key, locals } = action;
  return updateModule(state, module_key, (mod) => ({
    ...mod,
    locals: locals.length > 0 ? locals : undefined,
  }));
}

// ══════════════════════════════════════════════════════════════════════
// SET_DEPENDS_ON
// ══════════════════════════════════════════════════════════════════════

function handleSetDependsOn(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_DEPENDS_ON' }>,
): WorkspaceState {
  const { module_key, instance_id, depends_on } = action;
  const setDeps = <T extends Use | Resource>(child: T): T => {
    const { depends_on: _old, ...rest } = child;
    return { ...rest, ...normalizeDependsOn(depends_on) } as T;
  };

  return updateModule(state, module_key, (mod) => mapChildById(mod, instance_id, setDeps, setDeps));
}

// ══════════════════════════════════════════════════════════════════════
// SET_ENVIRONMENTS
// ══════════════════════════════════════════════════════════════════════

function handleSetEnvironments(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_ENVIRONMENTS' }>,
): WorkspaceState {
  return { ...state, environments: action.environments };
}

// ══════════════════════════════════════════════════════════════════════
// SET_ENVIRONMENT_BACKENDS
// ══════════════════════════════════════════════════════════════════════

function handleSetEnvironmentBackends(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_ENVIRONMENT_BACKENDS' }>,
): WorkspaceState {
  return { ...state, environment_backends: action.backends };
}

// ══════════════════════════════════════════════════════════════════════
// REFRESH_MODULE_DEFS
// ══════════════════════════════════════════════════════════════════════

function handleRefreshModuleDefs(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'REFRESH_MODULE_DEFS' }>,
): WorkspaceState {
  const { updated_modules } = action;
  if (Object.keys(updated_modules).length === 0) {
    return state;
  }
  return {
    ...state,
    modules: { ...state.modules, ...updated_modules },
  };
}
