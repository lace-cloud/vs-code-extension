import type {
  Instance,
  InputDef,
  OutputDef,
  OutputExport,
  ModuleDef,
  ProviderRequirement,
} from '../types/ir';
import { isVar, isOutExport } from '../types/ir';
import type { ResolvedSchema } from './resolve';

// ── inferVariables ──
//
// Scan all instances' inputs for var bindings. Collect unique variable
// names in first-seen order and return an InputDef[] with type 'string',
// required true for each.

export function inferVariables(instances: Instance[]): InputDef[] {
  const seen = new Set<string>();
  const result: InputDef[] = [];
  for (const inst of instances) {
    for (const binding of Object.values(inst.inputs)) {
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
// Auto-infer output exports from all child module instances. For each
// instance, resolve its schema and create an OutputExport entry for
// every output. Naming: `<instance_id>_<output_name>`.
// Resource/data instances with no resolvable outputs are skipped.

export function inferOutputExports(
  instances: Instance[],
  resolveSchema: (inst: Instance) => ResolvedSchema,
): Record<string, OutputExport> {
  const result: Record<string, OutputExport> = {};
  for (const inst of instances) {
    const schema = resolveSchema(inst);
    for (const out of schema.outputs) {
      result[`${inst.id}_${out.name}`] = { out: { module: inst.id, name: out.name } };
    }
  }
  return result;
}

// ── inferOutputDefs ──
//
// For each export where isOutExport(exp), find the source instance,
// resolve its schema, and look up the output by name to get the type.
// Falls back to type 'string' when source can't be resolved.

export function inferOutputDefs(
  exports: Record<string, OutputExport>,
  instances: Instance[],
  resolveSchema: (inst: Instance) => ResolvedSchema,
): OutputDef[] {
  const result: OutputDef[] = [];
  for (const [name, exp] of Object.entries(exports)) {
    if (isOutExport(exp)) {
      const sourceInst = instances.find((i) => i.id === exp.out.module);
      let type = 'string';
      if (sourceInst) {
        const schema = resolveSchema(sourceInst);
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
  modules: Record<string, ModuleDef>,
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
