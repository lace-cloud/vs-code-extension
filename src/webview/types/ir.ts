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

// ── Module Source ──

export type ModuleSource = {
  kind: 'git' | 'registry' | 'local';
  repo?: string;
  subdir?: string;
  ref?: string;
};

// ── Exports ──

export type Exports = {
  outputs: Record<string, OutputExport>;
};

// ── Use (child module reference) ──

export type Use = {
  id: string;
  module: string; // key into Bundle.modules (e.g. "aws-s3-bucket@v1.2.0")
  inputs?: Record<string, Binding>;
  depends_on?: string[];
};

// ── Resource (child resource/data reference) ──

export type Resource = {
  id: string;
  kind: 'resource' | 'data';
  type: string;
  inputs?: Record<string, Binding>;
  depends_on?: string[];
};

// ── Type guards ──

export const isUse = (child: Use | Resource): child is Use => 'module' in child;
export const isResource = (child: Use | Resource): child is Resource => 'type' in child;

// ── Module Definition (1:1 with Go Module) ──

export type Module = {
  id: string;
  version: string;
  source?: ModuleSource;
  interface: { inputs: InputDef[]; outputs: OutputDef[] };
  modules?: Use[];
  resources?: Resource[];
  locals?: LocalDef[];
  exports: Exports;
  terraform?: TerraformBlock;
  providers?: ProviderConfig[];
};

// ── Bundle (top-level wire format, 1:1 with Go Bundle) ──

export type Bundle = {
  schema_version: string;
  kind: 'bundle';
  entry: string; // key into modules, e.g. "iam-stack@v1.0.0"
  modules: Record<string, Module>;
  environments?: Record<string, Record<string, unknown>>;
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
