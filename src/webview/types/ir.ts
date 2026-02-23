// ── Binding ──
//
// Go's Binding is a flat struct with all fields + omitempty.
// We model it as a discriminated union in TypeScript.
// fromBundle normalizes incoming bindings via normalizeBinding()
// so that exactly one variant is set downstream.

export type Binding =
  | { lit: any }
  | { var: string }
  | { out: { module: string; name: string } }
  | { expr: { lang: 'hcl'; value: string } };

export const isLit = (b: Binding): b is { lit: any } => 'lit' in b;
export const isVar = (b: Binding): b is { var: string } => 'var' in b;
export const isOut = (b: Binding): b is { out: { module: string; name: string } } => 'out' in b;
export const isExpr = (b: Binding): b is { expr: { lang: 'hcl'; value: string } } => 'expr' in b;

// ── Module Interface ──
//
// Note: `interface` is legal as a TypeScript property name.
// Only reserved in declaration context (interface Foo {}).
// When destructuring: const { interface: iface } = def;

export type InputDef = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: any;
  validation?: { condition: string; error_message: string };
};

export type OutputDef = {
  name: string;
  type: string;
  description?: string;
  sensitive?: boolean;
};

// ── OutputExport ──
//
// Structurally identical to Binding. Kept as a separate type intentionally:
// OutputExport maps a composite *output* to an internal value source.
// Binding maps an instance *input* to a value source.
// These are distinct semantic concepts that may diverge on the Go side
// in the future. The same type guards (isOut, isVar, etc.) work on both
// since the shapes are identical.

export type OutputExport =
  | { out: { module: string; name: string } }
  | { lit: any }
  | { var: string }
  | { expr: { lang: 'hcl'; value: string } };

// Type guard aliases for OutputExport (use Binding guards — same shapes)
export const isOutExport = isOut as (
  e: OutputExport,
) => e is { out: { module: string; name: string } };

// ── Module Identity ──

export type ModuleRef = {
  module_id: string;
  version: string;
};

// ── Module Source ──

export type ModuleSource = {
  kind: 'git' | 'registry' | 'local';
  repo?: string;
  subdir?: string;
  ref?: string;
};

// ── Module Implementation (discriminated union) ──

export type LeafImpl = {
  kind: 'leaf';
  source: ModuleSource;
};

export type CompositeImpl = {
  kind: 'composite';
  graph: CompositeGraph;
};

export type ModuleImpl = LeafImpl | CompositeImpl;

// ── Composite Graph ──

export type CompositeGraph = {
  instances: Instance[];
  wires?: Wire[]; // derived in toBundle, absent in workspace
  exports: { outputs: Record<string, OutputExport> };
  locals?: LocalDef[];
};

// ── Instance (discriminated union) ──

type InstanceBase = {
  id: string;
  inputs: Record<string, Binding>;
  depends_on?: string[];
};

export type ModuleInstance = InstanceBase & {
  kind: 'module';
  use: ModuleRef;
};

export type ResourceInstance = InstanceBase & {
  kind: 'resource';
  type: string;
};

export type DataInstance = InstanceBase & {
  kind: 'data';
  type: string;
};

export type Instance = ModuleInstance | ResourceInstance | DataInstance;

export const isModuleInstance = (i: Instance): i is ModuleInstance => i.kind === 'module';
export const isResourceInstance = (i: Instance): i is ResourceInstance => i.kind === 'resource';
export const isDataInstance = (i: Instance): i is DataInstance => i.kind === 'data';

// ── Wire ──

export type Wire = {
  from: { module: string; port: string };
  to: { module: string; port: string };
};

// ── Module Definition ──

export type ModuleDef = {
  schema_version: '1.0';
  kind: 'module_def';
  id: string;
  version: string;
  description?: string;
  interface: { inputs: InputDef[]; outputs: OutputDef[] };
  impl: ModuleImpl;
  terraform?: TerraformBlock;
  providers?: ProviderConfig[];
};

// ── Module Bundle (top-level wire format) ──

export type ModuleBundle = {
  schema_version: '1.0';
  kind: 'module_bundle';
  entry: ModuleRef;
  modules: Record<string, ModuleDef>;
  environments?: Record<string, Record<string, any>>;
  environment_backends?: Record<string, BackendConfig>;
};

// ── Terraform Configuration ──

export type TerraformBlock = {
  required_version?: string;
  required_providers?: Record<string, ProviderRequirement>;
  backend?: BackendConfig;
};

export type ProviderRequirement = { source?: string; version?: string };
export type BackendConfig = { type: string; config: Record<string, any> };
export type ProviderConfig = { name: string; alias?: string; config: Record<string, any> };
export type LocalDef = { name: string; value: Binding };
