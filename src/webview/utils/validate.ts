import type { WorkspaceState } from '../types/workspace';
import { isOut, isUse, isOutExport } from '../types/ir';
import { depBareId } from './identifiers';
import { allChildren, childIds } from './children';

export type GraphError = {
  module_key?: string;
  instance_id?: string;
  input_name?: string;
  message: string;
};

export function validateWorkspace(workspace: WorkspaceState): GraphError[] {
  const errors: GraphError[] = [];

  for (const [key, def] of Object.entries(workspace.modules)) {
    const ids = childIds(def);
    const children = allChildren(def);

    // Check: duplicate instance IDs within a module
    const seenIds = new Set<string>();
    for (const child of children) {
      if (seenIds.has(child.id)) {
        errors.push({
          module_key: key,
          instance_id: child.id,
          message: `Duplicate instance ID "${child.id}"`,
        });
      }
      seenIds.add(child.id);
    }

    for (const child of children) {
      // Check: out bindings referencing unknown instances
      if (child.inputs) {
        for (const [inputName, binding] of Object.entries(child.inputs)) {
          if (isOut(binding) && !ids.has(binding.out.module)) {
            errors.push({
              module_key: key,
              instance_id: child.id,
              input_name: inputName,
              message: `Binding references unknown instance "${binding.out.module}"`,
            });
          }
        }
      }

      // Check: depends_on entries referencing unknown instances
      if (child.depends_on) {
        for (const dep of child.depends_on) {
          const bareId = depBareId(dep);
          if (!ids.has(bareId) && !ids.has(dep)) {
            errors.push({
              module_key: key,
              instance_id: child.id,
              message: `depends_on references unknown instance "${dep}"`,
            });
          }
        }
      }

      // Check: use references pointing to modules not in workspace
      if (isUse(child)) {
        if (!workspace.modules[child.module]) {
          errors.push({
            module_key: key,
            instance_id: child.id,
            message: `use references unknown module "${child.module}"`,
          });
        }
      }
    }

    // Check: export outputs referencing unknown instances
    if (def.exports?.outputs) {
      for (const [exportName, exp] of Object.entries(def.exports.outputs)) {
        if (isOutExport(exp) && !ids.has(exp.out.module)) {
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
