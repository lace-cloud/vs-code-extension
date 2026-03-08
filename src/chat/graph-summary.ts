// src/chat/graph-summary.ts
//
// Pure function: WorkspaceState → compact LLM-readable summary.
// No VS Code imports — safe for unit testing.

import type { WorkspaceState } from '../webview/types/workspace';
import type { Use, Resource, Binding } from '../webview/types/ir';
import { isUse, isOut, isVar, isLit, isExpr } from '../webview/types/ir';
import { deriveEdges } from '../webview/utils/derive';
import { resolveSchema } from '../webview/utils/resolve';
import { parseModuleKey } from '../webview/utils/identifiers';
import { allChildren } from '../webview/utils/children';

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
  const entryKey = workspace.entry;
  const entryDef = workspace.modules[entryKey];

  if (!entryDef) {
    return {
      module_name: parseModuleKey(entryKey).id,
      instance_count: 0,
      instances: [],
      connections: [],
      unbound_required_inputs: [],
      variables: [],
      exports: [],
    };
  }

  const children = allChildren(entryDef);
  const allUnbound: GraphSummary['unbound_required_inputs'] = [];

  // Summarize instances
  const instances: InstanceSummary[] = children.map((child: Use | Resource) => {
    const schema = resolveSchema(workspace, child);
    const inputDescriptions: Record<string, string> = {};
    for (const [name, binding] of Object.entries(child.inputs ?? {})) {
      inputDescriptions[name] = describeBinding(binding);
    }

    // Find unbound required inputs
    const unboundRequired: string[] = [];
    for (const inputDef of schema.inputs) {
      if (inputDef.required && !(child.inputs && inputDef.name in child.inputs)) {
        unboundRequired.push(inputDef.name);
        allUnbound.push({
          instance_id: child.id,
          input_name: inputDef.name,
          type: inputDef.type,
        });
      }
    }

    const moduleId = isUse(child) ? parseModuleKey(child.module).id : child.type;
    const version = isUse(child) ? parseModuleKey(child.module).version : '';

    return {
      id: child.id,
      module_id: moduleId,
      version,
      kind: isUse(child) ? 'module' : child.kind,
      inputs: inputDescriptions,
      outputs: schema.outputs.map((o) => o.name),
      unbound_required_inputs: unboundRequired,
    };
  });

  // Derive connections
  const edges = deriveEdges(children);
  const connections: ConnectionSummary[] = edges.map((e) => ({
    from_instance: e.source_instance,
    from_output: e.mapping.from,
    to_instance: e.target_instance,
    to_input: e.mapping.to,
  }));

  // Variables (composite interface inputs)
  const variables = entryDef.interface.inputs.map((i) => i.name);

  // Exports (composite output names)
  const exports = Object.keys(entryDef.exports?.outputs ?? {});

  return {
    module_name: parseModuleKey(entryKey).id,
    instance_count: instances.length,
    instances,
    connections,
    unbound_required_inputs: allUnbound,
    variables,
    exports,
  };
}
