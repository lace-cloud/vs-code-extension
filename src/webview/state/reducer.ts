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

    // ── Phase 2 ──
    case 'SET_VARIABLES':
      return handleSetVariables(state, action);
    case 'SET_EXPORTS':
      return handleSetExports(state, action);

    // ── Phase 3 ──
    case 'GROUP_INTO_COMPOSITE':
      return handleGroupIntoComposite(state, action);

    // ── Phase 4 ──
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

// ══════════════════════════════════════════════════════════════════════
// SET_VARIABLES (Phase 2)
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
// SET_EXPORTS (Phase 2)
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
// GROUP_INTO_COMPOSITE (Phase 3)
// ══════════════════════════════════════════════════════════════════════

function handleGroupIntoComposite(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'GROUP_INTO_COMPOSITE' }>,
): WorkspaceState {
  const { module_key, instance_ids, composite_id } = action;
  const parentDef = state.modules[module_key];
  if (!parentDef || parentDef.impl.kind !== 'composite') return state;

  const parentGraph = parentDef.impl.graph;
  const selectedSet = new Set(instance_ids);

  // ── 1. Partition instances ──
  const selectedInstances = parentGraph.instances.filter((i) => selectedSet.has(i.id));
  const remainingInstances = parentGraph.instances.filter((i) => !selectedSet.has(i.id));

  if (selectedInstances.length === 0) return state;

  // ── 2. Analyze boundary edges ──
  // Boundary-in: bindings on selected instances that reference modules outside selection (out bindings)
  // Boundary-out: bindings on remaining instances that reference modules inside selection (out bindings)
  // Also track var bindings on selected instances — these propagate into the sub-composite

  // Collect boundary-in variable names needed (var bindings used by selected instances)
  const neededVarNames = new Set<string>();
  for (const inst of selectedInstances) {
    for (const [, binding] of Object.entries(inst.inputs)) {
      if (isVar(binding)) {
        neededVarNames.add(binding.var);
      }
    }
  }

  // Collect boundary-in out references: selected instances referencing external modules
  // These become inputs on the sub-composite interface
  type BoundaryIn = {
    instance_id: string;
    input_name: string;
    source_module: string;
    source_output: string;
  };
  const boundaryIns: BoundaryIn[] = [];
  for (const inst of selectedInstances) {
    for (const [inputName, binding] of Object.entries(inst.inputs)) {
      if (isOut(binding) && !selectedSet.has(binding.out.module)) {
        boundaryIns.push({
          instance_id: inst.id,
          input_name: inputName,
          source_module: binding.out.module,
          source_output: binding.out.name,
        });
      }
    }
  }

  // Collect boundary-out: remaining instances referencing selected instances
  type BoundaryOut = {
    instance_id: string;
    input_name: string;
    source_module: string;
    source_output: string;
  };
  const boundaryOuts: BoundaryOut[] = [];
  for (const inst of remainingInstances) {
    for (const [inputName, binding] of Object.entries(inst.inputs)) {
      if (isOut(binding) && selectedSet.has(binding.out.module)) {
        boundaryOuts.push({
          instance_id: inst.id,
          input_name: inputName,
          source_module: binding.out.module,
          source_output: binding.out.name,
        });
      }
    }
  }

  // Collect parent exports referencing selected instances
  type ExportRef = { export_name: string; source_module: string; source_output: string };
  const parentExportRefs: ExportRef[] = [];
  for (const [exportName, exp] of Object.entries(parentGraph.exports.outputs)) {
    if (isOutExport(exp) && selectedSet.has(exp.out.module)) {
      parentExportRefs.push({
        export_name: exportName,
        source_module: exp.out.module,
        source_output: exp.out.name,
      });
    }
  }

  // ── 3. Build sub-composite interface ──

  // Inputs: one per unique boundary-in edge (deduplicated by source_module.source_output)
  // We create a synthetic input name for each boundary-in
  const subInputDefs: InputDef[] = [];
  const boundaryInMap = new Map<string, string>(); // "source_module:source_output" → input_name
  for (const bi of boundaryIns) {
    const key = `${bi.source_module}:${bi.source_output}`;
    if (!boundaryInMap.has(key)) {
      const inputName = `${bi.source_module}_${bi.source_output}`;
      boundaryInMap.set(key, inputName);
      subInputDefs.push({ name: inputName, type: 'string', required: true });
    }
  }

  // Propagate parent variables that selected instances reference
  const parentInputsByName = new Map(parentDef.interface.inputs.map((inp) => [inp.name, inp]));
  for (const varName of neededVarNames) {
    const parentInput = parentInputsByName.get(varName);
    if (parentInput) {
      subInputDefs.push({ ...parentInput });
    } else {
      subInputDefs.push({ name: varName, type: 'string', required: false });
    }
  }

  // Outputs: one per unique boundary-out edge + parent export refs into selection
  const subOutputDefs: OutputDef[] = [];
  const subExports: Record<string, OutputExport> = {};
  const outputNameSet = new Set<string>();

  for (const bo of boundaryOuts) {
    const outputName = `${bo.source_module}_${bo.source_output}`;
    if (!outputNameSet.has(outputName)) {
      outputNameSet.add(outputName);
      subOutputDefs.push({ name: outputName, type: 'string' });
      subExports[outputName] = { out: { module: bo.source_module, name: bo.source_output } };
    }
  }

  for (const er of parentExportRefs) {
    const outputName = `${er.source_module}_${er.source_output}`;
    if (!outputNameSet.has(outputName)) {
      outputNameSet.add(outputName);
      subOutputDefs.push({ name: outputName, type: 'string' });
      subExports[outputName] = { out: { module: er.source_module, name: er.source_output } };
    }
  }

  // ── 4. Rewrite selected instances' bindings for the sub-composite context ──
  const subInstances: Instance[] = selectedInstances.map((inst) => {
    const newInputs: Record<string, Binding> = {};
    for (const [inputName, binding] of Object.entries(inst.inputs)) {
      if (isOut(binding) && !selectedSet.has(binding.out.module)) {
        // Boundary-in: rewrite to var binding referencing the new sub-composite input
        const key = `${binding.out.module}:${binding.out.name}`;
        const subInputName = boundaryInMap.get(key)!;
        newInputs[inputName] = { var: subInputName };
      } else {
        // Internal out binding or var/lit/expr — preserved as-is
        newInputs[inputName] = binding;
      }
    }

    // Rewrite depends_on: keep only internal references
    const newDependsOn = inst.depends_on?.filter((dep) => selectedSet.has(dep));

    return {
      ...inst,
      inputs: newInputs,
      ...(newDependsOn && newDependsOn.length > 0 ? { depends_on: newDependsOn } : {}),
    } as Instance;
  });

  // ── 5. Build the new sub-composite ModuleDef ──
  const compositeKey = `${composite_id}@v1.0.0`;
  const subCompositeDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: composite_id,
    version: 'v1.0.0',
    interface: { inputs: subInputDefs, outputs: subOutputDefs },
    impl: {
      kind: 'composite',
      graph: {
        instances: subInstances,
        exports: { outputs: subExports },
      },
    },
  };

  // ── 6. Build the replacement instance in the parent ──
  const compositeInstanceId = composite_id;
  const compositeInstanceInputs: Record<string, Binding> = {};

  // Wire boundary-in: external out bindings → composite instance inputs
  for (const bi of boundaryIns) {
    const key = `${bi.source_module}:${bi.source_output}`;
    const subInputName = boundaryInMap.get(key)!;
    if (!compositeInstanceInputs[subInputName]) {
      compositeInstanceInputs[subInputName] = {
        out: { module: bi.source_module, name: bi.source_output },
      };
    }
  }

  // Pass through var bindings
  for (const varName of neededVarNames) {
    compositeInstanceInputs[varName] = { var: varName };
  }

  const compositeInstance: Instance = {
    kind: 'module',
    id: compositeInstanceId,
    use: { module_id: composite_id, version: 'v1.0.0' },
    inputs: compositeInstanceInputs,
  };

  // ── 7. Rewire remaining instances ──
  const rewiredRemaining: Instance[] = remainingInstances.map((inst) => {
    const newInputs: Record<string, Binding> = {};
    for (const [inputName, binding] of Object.entries(inst.inputs)) {
      if (isOut(binding) && selectedSet.has(binding.out.module)) {
        // Boundary-out: rewrite to reference composite instance's output
        const outputName = `${binding.out.module}_${binding.out.name}`;
        newInputs[inputName] = { out: { module: compositeInstanceId, name: outputName } };
      } else {
        newInputs[inputName] = binding;
      }
    }

    // Rewrite depends_on: replace selected instance refs with composite instance ref
    const newDependsOn = inst.depends_on?.map((dep) =>
      selectedSet.has(dep) ? compositeInstanceId : dep,
    );
    // Deduplicate depends_on
    const dedupedDependsOn = newDependsOn ? [...new Set(newDependsOn)] : undefined;

    return {
      ...inst,
      inputs: newInputs,
      ...(dedupedDependsOn && dedupedDependsOn.length > 0 ? { depends_on: dedupedDependsOn } : {}),
    } as Instance;
  });

  // ── 8. Rewire parent exports ──
  const newParentExports: Record<string, OutputExport> = {};
  for (const [exportName, exp] of Object.entries(parentGraph.exports.outputs)) {
    if (isOutExport(exp) && selectedSet.has(exp.out.module)) {
      const outputName = `${exp.out.module}_${exp.out.name}`;
      newParentExports[exportName] = { out: { module: compositeInstanceId, name: outputName } };
    } else {
      newParentExports[exportName] = exp;
    }
  }

  // ── 9. Layout migration ──
  const parentLayout = state.layouts[module_key] || { nodes: {} };

  // Compute center position for the new composite instance
  const selectedPositions = instance_ids
    .map((id) => parentLayout.nodes[id]?.position)
    .filter((p): p is { x: number; y: number } => !!p);

  const centerPos =
    selectedPositions.length > 0
      ? {
          x: selectedPositions.reduce((sum, p) => sum + p.x, 0) / selectedPositions.length,
          y: selectedPositions.reduce((sum, p) => sum + p.y, 0) / selectedPositions.length,
        }
      : { x: 0, y: 0 };

  // New parent layout: remove selected, add composite instance
  const newParentNodes: Record<string, { position: { x: number; y: number } }> = {};
  for (const [id, entry] of Object.entries(parentLayout.nodes)) {
    if (!selectedSet.has(id)) {
      newParentNodes[id] = entry;
    }
  }
  newParentNodes[compositeInstanceId] = { position: centerPos };

  // Sub-composite layout: migrated positions from parent
  const subLayoutNodes: Record<string, { position: { x: number; y: number } }> = {};
  for (const id of instance_ids) {
    if (parentLayout.nodes[id]) {
      subLayoutNodes[id] = parentLayout.nodes[id];
    }
  }

  // ── 10. Assemble final state ──
  const newParentGraph: CompositeGraph = {
    ...parentGraph,
    instances: [...rewiredRemaining, compositeInstance],
    exports: { outputs: newParentExports },
  };

  return {
    ...state,
    modules: {
      ...state.modules,
      [module_key]: {
        ...parentDef,
        impl: { kind: 'composite', graph: newParentGraph },
      },
      [compositeKey]: subCompositeDef,
    },
    layouts: {
      ...state.layouts,
      [module_key]: { nodes: newParentNodes },
      [compositeKey]: { nodes: subLayoutNodes },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// SET_TERRAFORM (Phase 4)
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
// SET_PROVIDERS (Phase 4)
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
// SET_LOCALS (Phase 4)
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
// SET_DEPENDS_ON (Phase 4)
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
// SET_ENVIRONMENTS (Phase 4)
// ══════════════════════════════════════════════════════════════════════

function handleSetEnvironments(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_ENVIRONMENTS' }>,
): WorkspaceState {
  return { ...state, environments: action.environments };
}

// ══════════════════════════════════════════════════════════════════════
// SET_ENVIRONMENT_BACKENDS (Phase 4)
// ══════════════════════════════════════════════════════════════════════

function handleSetEnvironmentBackends(
  state: WorkspaceState,
  action: Extract<WorkspaceAction, { type: 'SET_ENVIRONMENT_BACKENDS' }>,
): WorkspaceState {
  return { ...state, environment_backends: action.backends };
}
