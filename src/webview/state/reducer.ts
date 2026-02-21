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
import { isOut, isOutExport } from '../types/ir';
import type { WorkspaceState } from '../types/workspace';
import { uniqueInstanceId } from '../utils/identifiers';

// ══════════════════════════════════════════════════════════════════════
// WorkspaceAction — full type union (all phases)
// ══════════════════════════════════════════════════════════════════════

export type WorkspaceAction =
  // ── Instance operations (Phase 1) ──
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
  // ── Composite interface (Phase 2) ──
  | { type: 'SET_VARIABLES'; module_key: string; variables: InputDef[] }
  | {
      type: 'SET_EXPORTS';
      module_key: string;
      outputs: Record<string, OutputExport>;
      output_defs: OutputDef[];
    }
  // ── Nested composites (Phase 3) ──
  | {
      type: 'GROUP_INTO_COMPOSITE';
      module_key: string;
      instance_ids: string[];
      composite_id: string;
    }
  // ── Terraform config (Phase 4) ──
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
// workspaceReducer
// ══════════════════════════════════════════════════════════════════════

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    // ── Phase 1 ──
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

    // ── Phase 2-4: stubs ──
    case 'SET_VARIABLES':
    case 'SET_EXPORTS':
    case 'GROUP_INTO_COMPOSITE':
    case 'SET_TERRAFORM':
    case 'SET_PROVIDERS':
    case 'SET_LOCALS':
    case 'SET_DEPENDS_ON':
    case 'SET_ENVIRONMENTS':
    case 'SET_ENVIRONMENT_BACKENDS':
      return state;
  }
}

// ══════════════════════════════════════════════════════════════════════
// DROP_BUNDLE
// ══════════════════════════════════════════════════════════════════════

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

  // 1. Merge all non-entry ModuleDef entries into workspace.modules
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

  // 3. Process entry composite's instances - handle collisions
  const entryInstances: Instance[] = entryDef.impl.graph.instances;
  const renameMap = new Map<string, string>(); // old_id → new_id

  // First pass: determine renames
  for (const inst of entryInstances) {
    const newId = uniqueInstanceId(inst.id, existingIds);
    if (newId !== inst.id) {
      renameMap.set(inst.id, newId);
    }
    existingIds.add(newId);
  }

  // Second pass: apply renames to instances
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

    // Update depends_on references
    const newDependsOn = inst.depends_on?.map((dep) => renameMap.get(dep) ?? dep);

    return {
      ...inst,
      id: newId,
      inputs: newInputs,
      ...(newDependsOn ? { depends_on: newDependsOn } : {}),
    } as Instance;
  });

  // 4. Add layout entries from positions
  const existingLayout = state.layouts[module_key] || { nodes: {} };
  const newLayoutNodes = { ...existingLayout.nodes };
  for (const inst of newInstances) {
    const originalId = [...renameMap.entries()].find(([, v]) => v === inst.id)?.[0] ?? inst.id;
    if (positions[originalId]) {
      newLayoutNodes[inst.id] = { position: positions[originalId] };
    } else if (positions[inst.id]) {
      newLayoutNodes[inst.id] = { position: positions[inst.id] };
    } else {
      // Use computeLayout defaults for instances without explicit positions
      const idx = newInstances.indexOf(inst);
      const cols = Math.max(2, Math.ceil(Math.sqrt(newInstances.length)));
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      newLayoutNodes[inst.id] = { position: { x: col * 260, y: row * 180 } };
    }
  }

  // 5. Build new state
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

      // Update depends_on
      const updatedDependsOn = inst.depends_on?.map((dep) => (dep === old_id ? new_id : dep));

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

        // Remove from depends_on
        const cleanedDependsOn = inst.depends_on?.filter((dep) => dep !== instance_id);

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
  const nodes: Record<string, { position: { x: number; y: number } }> = {};
  for (const [id, pos] of Object.entries(positions)) {
    nodes[id] = { position: pos };
  }
  return {
    ...state,
    layouts: {
      ...state.layouts,
      [module_key]: { nodes },
    },
  };
}
