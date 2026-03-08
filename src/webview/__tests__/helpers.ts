import { readFileSync } from 'fs';
import { join } from 'path';
import type { WorkspaceState } from '../types/workspace';
import type { Bundle, Module, Use, Resource, InputDef } from '../types/ir';
import { allChildren, findChild } from '../utils/children';

// ── Fixture loading ──

export function loadFixture(name: string): Bundle {
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
 * - uses: Use[] children
 * - resources: Resource[] children
 */
export function makeWorkspace(
  children: Array<Use | Resource>,
  modules: Record<string, Module> = {},
  layouts: Record<string, any> = {},
  exports: Record<string, any> = {},
  inputs: InputDef[] = [],
): WorkspaceState {
  const moduleKey = 'root@v1.0.0';
  const uses = children.filter((c): c is Use => 'module' in c);
  const resources = children.filter((c): c is Resource => 'type' in c);
  const rootDef: Module = {
    id: 'root',
    version: 'v1.0.0',
    interface: { inputs, outputs: [] },
    ...(uses.length > 0 ? { modules: uses } : {}),
    ...(resources.length > 0 ? { resources } : {}),
    exports: { outputs: exports },
  };
  return {
    schema_version: '1.0',
    kind: 'bundle',
    entry: moduleKey,
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

// ── Child accessors ──

export function getChildren(
  state: WorkspaceState,
  key = 'root@v1.0.0',
): ReadonlyArray<Use | Resource> {
  const def = state.modules[key];
  if (!def) throw new Error(`Module "${key}" not found`);
  return allChildren(def);
}

export function getChild(state: WorkspaceState, id: string, key = 'root@v1.0.0'): Use | Resource {
  const def = state.modules[key];
  if (!def) throw new Error(`Module "${key}" not found`);
  const child = findChild(def, id);
  if (!child) throw new Error(`Child "${id}" not found`);
  return child;
}

export function getExports(state: WorkspaceState, key = 'root@v1.0.0') {
  const def = state.modules[key];
  if (!def) throw new Error(`Module "${key}" not found`);
  return def.exports.outputs;
}

// ── Common module definitions ──

export const vpcDef: Module = {
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
  exports: { outputs: {} },
};

export const subnetDef: Module = {
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
  exports: { outputs: {} },
};
