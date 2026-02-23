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
import { isOut, isVar, isOutExport } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';
import { uniqueInstanceId } from '../utils/identifiers';

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
  | { type: 'SET_ENVIRONMENT_BACKENDS'; backends: WorkspaceState['environment_backends'] };

// ══════════════════════════════════════════════════════════════════════
// updateCompositeGraph helper
// ══════════════════════════════════════════════════════════════════════

function updateCompositeGraph(
  state: WorkspaceState,
  module_key: string,
  fn: (graph: CompositeGraph) => CompositeGraph,
): WorkspaceState {
  const def = state.modules[module_key];
  if (!def || def.impl.kind !== 'composite') {
    return state;
  }
  return {
    ...state,
    modules: {
      ...state.modules,
      [module_key]: {
        ...def,
        impl: { ...def.impl, graph: fn(def.impl.graph) },
      },
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

function depBareId(dep: string): string {
  return dep.startsWith('module.') ? dep.slice(7) : dep;
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
      return action.workspace;

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

    const defKey = `${inst.use.module_id}@${inst.use.version}`;
    const def =
      allModules[defKey] ?? Object.values(allModules).find((m) => m.id === inst.use.module_id);

    if (!def || def.impl.kind !== 'composite') {
      // Leaf or unresolved — keep as-is
      result.push(inst);
      continue;
    }

    // Composite — unpack its graph's instances recursively
    const subGraph = def.impl.graph;
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

function handleDropBundle(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'DROP_BUNDLE' }>,
): WorkspaceState {
  const { module_key, deploy_bundle, positions } = action;
  const entryKey = `${deploy_bundle.entry.module_id}@${deploy_bundle.entry.version}`;
  const entryDef = deploy_bundle.modules[entryKey];

  if (!entryDef || entryDef.impl.kind !== 'composite') {
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
  if (!targetDef || targetDef.impl.kind !== 'composite') {
    return state;
  }

  const existingInstances = [...targetDef.impl.graph.instances];
  const existingIds = new Set(existingInstances.map((i) => i.id));

  // 3. Flatten: recursively unpack composite instances to leaves
  const allModulesForResolution = { ...mergedModules, ...deploy_bundle.modules };
  const entryInstances: Instance[] = flattenInstances(
    entryDef.impl.graph.instances,
    allModulesForResolution,
  );

  // 4. Handle ID collisions
  const renameMap = new Map<string, string>(); // old_id → new_id

  for (const inst of entryInstances) {
    const newId = uniqueInstanceId(inst.id, existingIds);
    if (newId !== inst.id) {
      renameMap.set(inst.id, newId);
    }
    existingIds.add(newId);
  }

  // Apply renames to instances
  const newInstances: Instance[] = entryInstances.map((inst) => {
    const newId = renameMap.get(inst.id) ?? inst.id;

    // Update out bindings within the dropped set that reference renamed instances
    const newInputs: Record<string, Binding> = {};
    for (const [name, binding] of Object.entries(inst.inputs)) {
      if (isOut(binding) && renameMap.has(binding.out.module)) {
        newInputs[name] = {
          out: { module: renameMap.get(binding.out.module)!, name: binding.out.name },
        };
      } else {
        newInputs[name] = binding;
      }
    }

    // Update depends_on references (entries may be "module.X" format)
    const newDependsOn = inst.depends_on?.map((dep) => {
      const bare = depBareId(dep);
      const renamed = renameMap.get(bare);
      if (renamed) {
        return dep.startsWith('module.') ? `module.${renamed}` : renamed;
      }
      return dep;
    });

    return {
      ...inst,
      id: newId,
      inputs: newInputs,
      ...(newDependsOn ? { depends_on: newDependsOn } : {}),
    } as Instance;
  });

  // 5. Add layout entries from positions
  const existingLayout = state.layouts[module_key] || { nodes: {} };
  const newLayoutNodes = { ...existingLayout.nodes };
  for (const inst of newInstances) {
    const originalId = [...renameMap.entries()].find(([, v]) => v === inst.id)?.[0] ?? inst.id;
    if (positions[originalId]) {
      newLayoutNodes[inst.id] = { position: positions[originalId] };
    } else if (positions[inst.id]) {
      newLayoutNodes[inst.id] = { position: positions[inst.id] };
    } else {
      const idx = newInstances.indexOf(inst);
      const cols = Math.max(2, Math.ceil(Math.sqrt(newInstances.length)));
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      newLayoutNodes[inst.id] = { position: { x: col * 260, y: row * 180 } };
    }
  }

  // 6. Build new state
  const updatedGraph: CompositeGraph = {
    ...targetDef.impl.graph,
    instances: [...existingInstances, ...newInstances],
  };

  return {
    ...state,
    modules: {
      ...mergedModules,
      [module_key]: {
        ...targetDef,
        impl: { kind: 'composite', graph: updatedGraph },
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
      const updatedInputs: Record<string, Binding> = {};
      for (const [name, binding] of Object.entries(inst.inputs)) {
        if (isOut(binding) && binding.out.module === old_id) {
          updatedInputs[name] = { out: { module: new_id, name: binding.out.name } };
        } else {
          updatedInputs[name] = binding;
        }
      }

      // Update depends_on (entries may be "module.X" format)
      const updatedDependsOn = inst.depends_on?.map((dep) =>
        depRenameInstance(dep, old_id, new_id),
      );

      return {
        ...inst,
        id: updatedId,
        inputs: updatedInputs,
        ...(updatedDependsOn ? { depends_on: updatedDependsOn } : {}),
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
        const cleanedInputs: Record<string, Binding> = {};
        for (const [name, binding] of Object.entries(inst.inputs)) {
          if (isOut(binding) && binding.out.module === instance_id) {
            // Skip — remove the binding
          } else {
            cleanedInputs[name] = binding;
          }
        }

        // Remove from depends_on (entries may be "module.X" format)
        const cleanedDependsOn = inst.depends_on?.filter(
          (dep) => !depMatchesInstance(dep, instance_id),
        );

        // Build result without depends_on, then add it back only if non-empty
        const { depends_on: _deps, ...instWithoutDeps } = inst;
        return {
          ...instWithoutDeps,
          inputs: cleanedInputs,
          ...(cleanedDependsOn && cleanedDependsOn.length > 0
            ? { depends_on: cleanedDependsOn }
            : {}),
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
    return {
      ...newState,
      layouts: {
        ...newState.layouts,
        [module_key]: { nodes: restNodes },
      },
    };
  }

  return newState;
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
  // Update impl.graph.exports.outputs with the wiring
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
    instances: graph.instances.map((inst) =>
      inst.id === instance_id
        ? { ...inst, depends_on: depends_on.length > 0 ? depends_on : undefined }
        : inst,
    ),
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
