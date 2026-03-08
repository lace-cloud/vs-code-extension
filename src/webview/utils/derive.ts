import type { Binding } from '../types/ir';
import { isOut } from '../types/ir';

export type DerivedEdge = {
  source_instance: string;
  target_instance: string;
  mapping: { from: string; to: string };
};

export function deriveEdges(
  children: ReadonlyArray<{ id: string; inputs?: Record<string, Binding> }>,
): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  for (const target of children) {
    if (!target.inputs) continue;
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
