import type {
  Use,
  Resource,
  Binding,
  InputDef,
  OutputDef,
  OutputExport,
  Module,
  ProviderRequirement,
} from '../types/ir';
import { isVar, isOutExport } from '../types/ir';
import type { ResolvedSchema } from './resolve';

// ── inferVariables ──
//
// Scan all children's inputs for var bindings. Collect unique variable
// names in first-seen order and return an InputDef[] with type 'string',
// required true for each.

export function inferVariables(
  children: ReadonlyArray<{ inputs?: Record<string, Binding> }>,
): InputDef[] {
  const seen = new Set<string>();
  const result: InputDef[] = [];
  for (const child of children) {
    if (!child.inputs) continue;
    for (const binding of Object.values(child.inputs)) {
      if (isVar(binding) && !seen.has(binding.var)) {
        seen.add(binding.var);
        result.push({ name: binding.var, type: 'string', required: true });
      }
    }
  }
  return result;
}

// ── inferOutputExports ──
//
// Auto-infer output exports from all child instances. For each
// child, resolve its schema and create an OutputExport entry for
// every output. Naming: `<child_id>_<output_name>`.
// Children with no resolvable outputs are skipped.

export function inferOutputExports(
  children: ReadonlyArray<Use | Resource>,
  resolveSchema: (child: Use | Resource) => ResolvedSchema,
): Record<string, OutputExport> {
  const result: Record<string, OutputExport> = {};
  for (const child of children) {
    const schema = resolveSchema(child);
    for (const out of schema.outputs) {
      result[`${child.id}_${out.name}`] = { out: { module: child.id, name: out.name } };
    }
  }
  return result;
}

// ── inferOutputDefs ──
//
// For each export where isOutExport(exp), find the source child,
// resolve its schema, and look up the output by name to get the type.
// Falls back to type 'string' when source can't be resolved.

export function inferOutputDefs(
  exports: Record<string, OutputExport>,
  children: ReadonlyArray<Use | Resource>,
  resolveSchema: (child: Use | Resource) => ResolvedSchema,
): OutputDef[] {
  const result: OutputDef[] = [];
  for (const [name, exp] of Object.entries(exports)) {
    if (isOutExport(exp)) {
      const sourceChild = children.find((c) => c.id === exp.out.module);
      let type = 'string';
      if (sourceChild) {
        const schema = resolveSchema(sourceChild);
        const outputDef = schema.outputs.find((o) => o.name === exp.out.name);
        if (outputDef) {
          type = outputDef.type;
        }
      }
      result.push({ name, type });
    }
  }
  return result;
}

// ── inferRequiredProviders ──
//
// Iterate non-entry module defs and merge all terraform.required_providers
// entries. Last-seen version wins on conflicts.

export function inferRequiredProviders(
  modules: Record<string, Module>,
  entryKey: string,
): Record<string, ProviderRequirement> {
  const merged: Record<string, ProviderRequirement> = {};
  for (const [key, def] of Object.entries(modules)) {
    if (key === entryKey) continue;
    const providers = def.terraform?.required_providers;
    if (providers) {
      for (const [name, req] of Object.entries(providers)) {
        merged[name] = req;
      }
    }
  }
  return merged;
}
