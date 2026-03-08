import type { Module, Use, Resource } from '../types/ir';

export function allChildren(mod: Module): ReadonlyArray<Use | Resource> {
  return [...(mod.modules ?? []), ...(mod.resources ?? [])];
}

export function findChild(mod: Module, id: string): Use | Resource | undefined {
  return mod.modules?.find((u) => u.id === id) ?? mod.resources?.find((r) => r.id === id);
}

export function childIds(mod: Module): Set<string> {
  return new Set(allChildren(mod).map((c) => c.id));
}
