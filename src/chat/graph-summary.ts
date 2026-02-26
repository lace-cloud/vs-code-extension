// src/chat/graph-summary.ts
//
// Pure function: WorkspaceState → compact LLM-readable summary.
// No VS Code imports — safe for unit testing.

import type { WorkspaceState } from '../webview/types/workspace';
import type { Instance, Binding } from '../webview/types/ir';
import { isModuleInstance, isOut, isVar, isLit, isExpr } from '../webview/types/ir';
import { deriveEdges } from '../webview/utils/derive';
import { resolveSchema } from '../webview/utils/resolve';

// ── Output types ──

export type InstanceSummary = {
  id: string;
  module_id: string;
  version: string;
  kind: string;
  inputs: Record<string, string>; // human-readable binding descriptions
  outputs: string[];
  unbound_required_inputs: string[];
};

export type ConnectionSummary = {
  from_instance: string;
  from_output: string;
  to_instance: string;
  to_input: string;
};

export type GraphSummary = {
  module_name: string;
  instance_count: number;
  instances: InstanceSummary[];
  connections: ConnectionSummary[];
  unbound_required_inputs: Array<{
    instance_id: string;
    input_name: string;
    type: string;
  }>;
  variables: string[];
  exports: string[];
};

// ── Helpers ──

function describeBinding(b: Binding): string {
  if (isOut(b)) return `← ${b.out.module}.${b.out.name}`;
  if (isVar(b)) return `var.${b.var}`;
  if (isLit(b)) return JSON.stringify(b.lit);
  if (isExpr(b)) return `expr: ${b.expr.value}`;
  return 'unknown';
}

// ── Main ──

export function summarizeGraph(workspace: WorkspaceState): GraphSummary {
  const entryKey = `${workspace.entry.module_id}@${workspace.entry.version}`;
  const entryDef = workspace.modules[entryKey];

  if (!entryDef) {
    return {
      module_name: workspace.entry.module_id,
      instance_count: 0,
      instances: [],
      connections: [],
      unbound_required_inputs: [],
      variables: [],
      exports: [],
    };
  }

  const graph = entryDef.graph;
  const allUnbound: GraphSummary['unbound_required_inputs'] = [];

  // Summarize instances
  const instances: InstanceSummary[] = graph.instances.map((inst: Instance) => {
    const schema = resolveSchema(workspace, inst);
    const inputDescriptions: Record<string, string> = {};
    for (const [name, binding] of Object.entries(inst.inputs)) {
      inputDescriptions[name] = describeBinding(binding);
    }

    // Find unbound required inputs
    const unboundRequired: string[] = [];
    for (const inputDef of schema.inputs) {
      if (inputDef.required && !(inputDef.name in inst.inputs)) {
        unboundRequired.push(inputDef.name);
        allUnbound.push({
          instance_id: inst.id,
          input_name: inputDef.name,
          type: inputDef.type,
        });
      }
    }

    const moduleId = isModuleInstance(inst) ? inst.use.module_id : inst.type;
    const version = isModuleInstance(inst) ? inst.use.version : '';

    return {
      id: inst.id,
      module_id: moduleId,
      version,
      kind: inst.kind,
      inputs: inputDescriptions,
      outputs: schema.outputs.map((o) => o.name),
      unbound_required_inputs: unboundRequired,
    };
  });

  // Derive connections
  const edges = deriveEdges(graph.instances);
  const connections: ConnectionSummary[] = edges.map((e) => ({
    from_instance: e.source_instance,
    from_output: e.mapping.from,
    to_instance: e.target_instance,
    to_input: e.mapping.to,
  }));

  // Variables (composite interface inputs)
  const variables = entryDef.interface.inputs.map((i) => i.name);

  // Exports (composite output names)
  const exports = Object.keys(graph.exports?.outputs ?? {});

  return {
    module_name: workspace.entry.module_id,
    instance_count: instances.length,
    instances,
    connections,
    unbound_required_inputs: allUnbound,
    variables,
    exports,
  };
}
