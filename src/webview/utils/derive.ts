import type { Instance, Wire } from '../types/ir';
import { isOut } from '../types/ir';

export type DerivedEdge = {
  source_instance: string;
  target_instance: string;
  mapping: { from: string; to: string };
};

export function deriveEdges(instances: Instance[]): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  for (const target of instances) {
    for (const [inputName, binding] of Object.entries(target.inputs)) {
      if (isOut(binding)) {
        edges.push({
          source_instance: binding.out.module,
          target_instance: target.id,
          mapping: { from: binding.out.name, to: inputName },
        });
      }
    }
  }
  return edges;
}

export function deriveWires(instances: Instance[]): Wire[] {
  return deriveEdges(instances).map((e) => ({
    from: { module: e.source_instance, port: `outputs.${e.mapping.from}` },
    to: { module: e.target_instance, port: `inputs.${e.mapping.to}` },
  }));
}
