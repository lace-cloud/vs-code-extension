import type { WorkspaceState } from '../types/workspace';
import { isOut, isModuleInstance, isOutExport } from '../types/ir';

export type GraphError = {
  module_key?: string;
  instance_id?: string;
  input_name?: string;
  message: string;
};

export function validateWorkspace(workspace: WorkspaceState): GraphError[] {
  const errors: GraphError[] = [];

  for (const [key, def] of Object.entries(workspace.modules)) {
    const graph = def.graph;
    const instanceIds = new Set(graph.instances.map((i) => i.id));

    // Check: duplicate instance IDs within a composite
    const seenIds = new Set<string>();
    for (const inst of graph.instances) {
      if (seenIds.has(inst.id)) {
        errors.push({
          module_key: key,
          instance_id: inst.id,
          message: `Duplicate instance ID "${inst.id}"`,
        });
      }
      seenIds.add(inst.id);
    }

    for (const inst of graph.instances) {
      // Check: out bindings referencing unknown instances
      for (const [inputName, binding] of Object.entries(inst.inputs)) {
        if (isOut(binding) && !instanceIds.has(binding.out.module)) {
          errors.push({
            module_key: key,
            instance_id: inst.id,
            input_name: inputName,
            message: `Binding references unknown instance "${binding.out.module}"`,
          });
        }
      }

      // Check: depends_on entries referencing unknown instances
      if (inst.depends_on) {
        for (const dep of inst.depends_on) {
          // depends_on may use "module.NAME" format — strip prefix for lookup
          const bareId = dep.startsWith('module.') ? dep.slice(7) : dep;
          if (!instanceIds.has(bareId) && !instanceIds.has(dep)) {
            errors.push({
              module_key: key,
              instance_id: inst.id,
              message: `depends_on references unknown instance "${dep}"`,
            });
          }
        }
      }

      // Check: use references pointing to modules not in workspace
      if (isModuleInstance(inst)) {
        const refKey = `${inst.use.module_id}@${inst.use.version}`;
        const found =
          workspace.modules[refKey] ||
          Object.values(workspace.modules).some((m) => m.id === inst.use.module_id);
        if (!found) {
          errors.push({
            module_key: key,
            instance_id: inst.id,
            message: `use references unknown module "${inst.use.module_id}@${inst.use.version}"`,
          });
        }
      }
    }

    // Check: export outputs referencing unknown instances
    if (graph.exports?.outputs) {
      for (const [exportName, exp] of Object.entries(graph.exports.outputs)) {
        if (isOutExport(exp) && !instanceIds.has(exp.out.module)) {
          errors.push({
            module_key: key,
            message: `Export "${exportName}" references unknown instance "${exp.out.module}"`,
          });
        }
      }
    }
  }

  return errors;
}
