import type {
  Binding,
  OutputExport,
  InputDef,
  OutputDef,
  TerraformBlock,
  ProviderConfig,
  LocalDef,
  CompositeGraph,
  ModuleBundle,
  ModuleDef,
  Instance,
} from '../types/ir';
import { isOut, isVar, isOutExport, isModuleInstance } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';
import { uniqueInstanceId, depBareId, makeModuleKey } from '../utils/identifiers';
import { computeLayout } from '../utils/bundle';

// ══════════════════════════════════════════════════════════════════════
// WorkspaceAction — full type union (all phases)
// ══════════════════════════════════════════════════════════════════════

export type WorkspaceAction =
  // ── Core editing ──
  | {
      type: 'DROP_BUNDLE';
      module_key: string;
      deploy_bundle: ModuleBundle;
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
  | { type: 'REFRESH_MODULE_DEFS'; updated_modules: Record<string, ModuleDef> };

// ══════════════════════════════════════════════════════════════════════
// updateCompositeGraph helper
// ══════════════════════════════════════════════════════════════════════

function updateCompositeGraph(
  state: WorkspaceState,
  module_key: string,
  fn: (graph: CompositeGraph) => CompositeGraph,
): WorkspaceState {
  const def = state.modules[module_key];
  if (!def) {
    return state;
  }
  return {
    ...state,
    modules: {
      ...state.modules,
      [module_key]: { ...def, graph: fn(def.graph) },
    },
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
 * Recursively flatten a composite's instances to leaf instances.
 *
 * For each instance in a composite graph:
 * - If it references a leaf module → keep it as-is.
 * - If it references a composite module → replace it with that composite's
 *   (recursively flattened) instances, resolving bindings through the
 *   composite's interface (inputs via instance bindings, outputs via exports).
 */
function flattenInstances(
  instances: Instance[],
  allModules: Record<string, ModuleDef>,
): Instance[] {
  const result: Instance[] = [];

  for (const inst of instances) {
    if (inst.kind !== 'module') {
      // resource / data instances are always leaves
      result.push(inst);
      continue;
    }

    const defKey = makeModuleKey(inst.use.module_id, inst.use.version);
    const def =
      allModules[defKey] ?? Object.values(allModules).find((m) => m.id === inst.use.module_id);

    if (!def || def.graph.instances.length === 0) {
      // Leaf-like (no sub-instances) or unresolved — keep as-is
      result.push(inst);
      continue;
    }

    // Has sub-instances — unpack its graph's instances recursively
    const subGraph = def.graph;
    const subInstances = flattenInstances(subGraph.instances, allModules);

    for (const subInst of subInstances) {
      // Resolve each sub-instance's bindings through the parent composite instance
      const resolvedInputs: Record<string, Binding> = {};

      for (const [inputName, binding] of Object.entries(subInst.inputs)) {
        if (isVar(binding)) {
          // var binding: look up what the parent composite instance passes for this variable
          const parentBinding = inst.inputs[binding.var];
          if (parentBinding) {
            resolvedInputs[inputName] = parentBinding;
          } else {
            // Pass through as-is (the variable might be defined at a higher scope)
            resolvedInputs[inputName] = binding;
          }
        } else if (isOut(binding)) {
          // out binding referencing a sibling within the sub-composite
          // The sibling is also being flattened, so the reference stays valid
          resolvedInputs[inputName] = binding;
        } else {
          // lit or expr — keep as-is
          resolvedInputs[inputName] = binding;
        }
      }

      result.push({
        ...subInst,
        inputs: resolvedInputs,
      } as Instance);
    }
  }

  return result;
}

/** Deduplicate instance IDs against existing ones and cascade renames through bindings. */
function resolveIdCollisions(
  instances: Instance[],
  existingIds: Set<string>,
): { instances: Instance[]; renameMap: Map<string, string> } {
  const renameMap = new Map<string, string>();
  const ids = new Set(existingIds);

  for (const inst of instances) {
    const newId = uniqueInstanceId(inst.id, ids);
    if (newId !== inst.id) {
      renameMap.set(inst.id, newId);
    }
    ids.add(newId);
  }

  if (renameMap.size === 0) {
    return { instances, renameMap };
  }

  const renamed = instances.map((inst) => {
    const newId = renameMap.get(inst.id) ?? inst.id;

    const newInputs = mapBindings(inst.inputs, (binding) => {
      if (isOut(binding) && renameMap.has(binding.out.module)) {
        return { out: { module: renameMap.get(binding.out.module)!, name: binding.out.name } };
      }
      return binding;
    });

    const newDependsOn = inst.depends_on?.map((dep) => {
      const bare = depBareId(dep);
      const renamed = renameMap.get(bare);
      if (renamed) return dep.startsWith('module.') ? `module.${renamed}` : renamed;
      return dep;
    });

    return {
      ...inst,
      id: newId,
      inputs: newInputs,
      ...normalizeDependsOn(newDependsOn),
    } as Instance;
  });

  return { instances: renamed, renameMap };
}

function handleDropBundle(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'DROP_BUNDLE' }>,
): WorkspaceState {
  const { module_key, deploy_bundle, positions } = action;
  const entryKey = makeModuleKey(deploy_bundle.entry.module_id, deploy_bundle.entry.version);
  const entryDef = deploy_bundle.modules[entryKey];

  if (!entryDef) {
    return state;
  }

  // 1. Merge all non-entry ModuleDef entries into workspace.modules (leaf defs needed for resolution)
  const mergedModules = { ...state.modules };
  for (const [key, def] of Object.entries(deploy_bundle.modules)) {
    if (key !== entryKey) {
      mergedModules[key] = def as ModuleDef;
    }
  }

  // 2. Get existing instance IDs in the target composite
  const targetDef = state.modules[module_key];
  if (!targetDef) {
    return state;
  }

  const existingInstances = [...targetDef.graph.instances];
  const existingIds = new Set(existingInstances.map((i) => i.id));

  // 3. Flatten: recursively unpack composite instances to leaves
  const allModulesForResolution = { ...mergedModules, ...deploy_bundle.modules };
  const entryInstances: Instance[] = flattenInstances(
    entryDef.graph.instances,
    allModulesForResolution,
  );

  // 4. Handle ID collisions and apply renames
  const { instances: newInstances, renameMap } = resolveIdCollisions(entryInstances, existingIds);

  // 5. Add layout entries from positions
  const existingLayout = state.layouts[module_key] || { nodes: {} };
  // Build position hints: prefer user-supplied positions, map renamed IDs
  const positionHints: Record<string, { x: number; y: number }> = {};
  for (const inst of newInstances) {
    const originalId = [...renameMap.entries()].find(([, v]) => v === inst.id)?.[0] ?? inst.id;
    if (positions[originalId]) {
      positionHints[inst.id] = positions[originalId];
    } else if (positions[inst.id]) {
      positionHints[inst.id] = positions[inst.id];
    }
  }
  const dropLayout = computeLayout(newInstances, positionHints);
  const newLayoutNodes = { ...existingLayout.nodes, ...dropLayout.nodes };

  // 6. Build new state
  const updatedGraph: CompositeGraph = {
    ...targetDef.graph,
    instances: [...existingInstances, ...newInstances],
  };

  return {
    ...state,
    modules: {
      ...mergedModules,
      [module_key]: {
        ...targetDef,
        graph: updatedGraph,
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
  return updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
    instances: graph.instances.map((inst) =>
      inst.id === target_instance
        ? {
            ...inst,
            inputs: {
              ...inst.inputs,
              [mapping.to]: { out: { module: source_instance, name: mapping.from } },
            },
          }
        : inst,
    ),
  }));
}

// ══════════════════════════════════════════════════════════════════════
// DISCONNECT
// ══════════════════════════════════════════════════════════════════════

function handleDisconnect(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'DISCONNECT' }>,
): WorkspaceState {
  const { module_key, target_instance, input_name } = action;
  return updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
    instances: graph.instances.map((inst) => {
      if (inst.id !== target_instance) return inst;
      const { [input_name]: _removed, ...restInputs } = inst.inputs;
      return { ...inst, inputs: restInputs };
    }),
  }));
}

// ══════════════════════════════════════════════════════════════════════
// UPDATE_INPUTS
// ══════════════════════════════════════════════════════════════════════

function handleUpdateInputs(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'UPDATE_INPUTS' }>,
): WorkspaceState {
  const { module_key, instance_id, inputs } = action;
  return updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
    instances: graph.instances.map((inst) =>
      inst.id === instance_id ? { ...inst, inputs } : inst,
    ),
  }));
}

// ══════════════════════════════════════════════════════════════════════
// RENAME_INSTANCE
// ══════════════════════════════════════════════════════════════════════

function handleRenameInstance(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'RENAME_INSTANCE' }>,
): WorkspaceState {
  const { module_key, old_id, new_id } = action;

  // Update graph
  const newState = updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
    // Update instance ID + cascade to sibling out bindings
    instances: graph.instances.map((inst) => {
      // Rename the instance itself
      const updatedId = inst.id === old_id ? new_id : inst.id;

      // Update out bindings referencing old_id
      const updatedInputs = mapBindings(inst.inputs, (binding) => {
        if (isOut(binding) && binding.out.module === old_id) {
          return { out: { module: new_id, name: binding.out.name } };
        }
        return binding;
      });

      // Update depends_on (entries may be "module.X" format)
      const updatedDependsOn = inst.depends_on?.map((dep) =>
        depRenameInstance(dep, old_id, new_id),
      );

      return {
        ...inst,
        id: updatedId,
        inputs: updatedInputs,
        ...normalizeDependsOn(updatedDependsOn),
      } as Instance;
    }),
    // Update exports
    exports: {
      outputs: Object.fromEntries(
        Object.entries(graph.exports.outputs).map(([name, exp]) => {
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
  modules: Record<string, ModuleDef>,
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

    for (const inst of def.graph.instances) {
      if (isModuleInstance(inst)) {
        const refKey = makeModuleKey(inst.use.module_id, inst.use.version);
        if (!reachable.has(refKey)) {
          queue.push(refKey);
        }
      }
    }
  }

  return reachable;
}

/** Remove module defs not reachable from the entry module. */
function gcOrphanedModules(state: WorkspaceState): WorkspaceState {
  const entryKey = makeModuleKey(state.entry.module_id, state.entry.version);
  const reachable = collectReachableModuleKeys(state.modules, entryKey);

  const moduleKeys = Object.keys(state.modules);
  if (moduleKeys.every((k) => reachable.has(k))) {
    return state; // nothing to collect
  }

  const cleanedModules: Record<string, ModuleDef> = {};
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

  const newState = updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
    // Remove instance, clean up sibling out bindings, clean up depends_on
    instances: graph.instances
      .filter((inst) => inst.id !== instance_id)
      .map((inst) => {
        // Remove out bindings referencing deleted instance
        const cleanedInputs = mapBindings(inst.inputs, (binding) => {
          if (isOut(binding) && binding.out.module === instance_id) {
            return undefined; // Remove the binding
          }
          return binding;
        });

        // Remove from depends_on (entries may be "module.X" format)
        const cleanedDependsOn = inst.depends_on?.filter(
          (dep) => !depMatchesInstance(dep, instance_id),
        );

        const { depends_on: _deps, ...instWithoutDeps } = inst;
        return {
          ...instWithoutDeps,
          inputs: cleanedInputs,
          ...normalizeDependsOn(cleanedDependsOn),
        } as Instance;
      }),
    // Clean up exports referencing deleted instance
    exports: {
      outputs: Object.fromEntries(
        Object.entries(graph.exports.outputs).filter(([, exp]) => {
          if (isOutExport(exp) && exp.out.module === instance_id) {
            return false;
          }
          return true;
        }),
      ),
    },
  }));

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

  const clearedState = updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
    instances: [],
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
  const def = state.modules[module_key];
  if (!def) return state;
  // Update interface.outputs with the output definitions
  const withInterface = {
    ...def,
    interface: { ...def.interface, outputs: output_defs },
  };
  // Update graph.exports.outputs with the wiring
  return updateCompositeGraph(
    { ...state, modules: { ...state.modules, [module_key]: withInterface } },
    module_key,
    (graph) => ({ ...graph, exports: { outputs } }),
  );
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
  return updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
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
  return updateCompositeGraph(state, module_key, (graph) => ({
    ...graph,
    instances: graph.instances.map((inst) => {
      if (inst.id !== instance_id) return inst;
      const { depends_on: _old, ...rest } = inst;
      return { ...rest, ...normalizeDependsOn(depends_on) } as Instance;
    }),
  }));
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
