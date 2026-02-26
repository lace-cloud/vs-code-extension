import { readFileSync } from 'fs';
import { join } from 'path';
import type { WorkspaceState } from '../types/workspace';
import type { Instance, ModuleDef, ModuleBundle, InputDef } from '../types/ir';

// ── Fixture loading ──

export function loadFixture(name: string): ModuleBundle {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'));
}

// ── Workspace builders ──

/**
 * Build a minimal workspace with one root composite.
 * Supports all test file variants via optional fields:
 * - modules: extra module defs to merge
 * - layouts: layout overrides
 * - exports: root module export outputs
 * - inputs: root module input interface defs
 */
export function makeWorkspace(
  instances: Instance[],
  modules: Record<string, ModuleDef> = {},
  layouts: Record<string, any> = {},
  exports: Record<string, any> = {},
  inputs: InputDef[] = [],
): WorkspaceState {
  const moduleKey = 'root@v1.0.0';
  const rootDef: ModuleDef = {
    schema_version: '1.0',
    kind: 'module_def',
    id: 'root',
    version: 'v1.0.0',
    interface: { inputs, outputs: [] },
    graph: {
      instances,
      exports: { outputs: exports },
    },
  };
  return {
    schema_version: '1.0',
    kind: 'module_bundle',
    entry: { module_id: 'root', version: 'v1.0.0' },
    modules: { [moduleKey]: rootDef, ...modules },
    layouts: {
      [moduleKey]: layouts[moduleKey] || { nodes: {} },
      ...layouts,
    },
  };
}

export function makeEmptyWorkspace(): WorkspaceState {
  return makeWorkspace([]);
}

// ── Instance accessors ──

export function getGraph(state: WorkspaceState, key = 'root@v1.0.0') {
  const def = state.modules[key];
  if (!def) throw new Error(`Module "${key}" not found`);
  return def.graph;
}

export function getInst(state: WorkspaceState, id: string, key = 'root@v1.0.0'): Instance {
  const graph = getGraph(state, key);
  const inst = graph.instances.find((i) => i.id === id);
  if (!inst) throw new Error(`Instance "${id}" not found`);
  return inst;
}

export function getInstances(state: WorkspaceState, key = 'root@v1.0.0'): Instance[] {
  return getGraph(state, key).instances;
}

export function getExports(state: WorkspaceState, key = 'root@v1.0.0') {
  return getGraph(state, key).exports.outputs;
}

// ── Common module definitions ──

export const vpcDef: ModuleDef = {
  schema_version: '1.0',
  kind: 'module_def',
  id: 'aws/vpc',
  version: 'v1.0.0',
  interface: {
    inputs: [
      { name: 'cidr_block', type: 'string', required: true },
      { name: 'enable_dns', type: 'bool', required: false },
    ],
    outputs: [{ name: 'vpc_id', type: 'string' }],
  },
  source: { kind: 'registry' },
  graph: { instances: [], exports: { outputs: {} } },
};

export const subnetDef: ModuleDef = {
  schema_version: '1.0',
  kind: 'module_def',
  id: 'aws/subnet',
  version: 'v1.0.0',
  interface: {
    inputs: [
      { name: 'vpc_id', type: 'string', required: true },
      { name: 'cidr_block', type: 'string', required: true },
    ],
    outputs: [{ name: 'subnet_id', type: 'string' }],
  },
  source: { kind: 'registry' },
  graph: { instances: [], exports: { outputs: {} } },
};
