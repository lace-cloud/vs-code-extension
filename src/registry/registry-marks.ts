// Favourites and recently used modules, kept in the extension's global
// state: the developer's own, in every window. Each names a module by its
// author and name (`moduleKey`), which every version it publishes keeps, so
// a new latest version keeps its star and its place among the recent.
import type * as vscode from 'vscode';

const FAVOURITES = 'lace.registry.favourites';
const RECENTS = 'lace.registry.recents';
const RECENT_LIMIT = 5;

export type RegistryMarks = {
  favourites: () => readonly string[];
  // Most recently placed first.
  recents: () => readonly string[];
  toggleFavourite: (key: string) => Promise<void>;
  // The module was just placed.
  placed: (key: string) => Promise<void>;
  // `listener` is called after each change, until the returned function is.
  onChanged: (listener: () => void) => () => void;
};

export const toggled = (keys: readonly string[], key: string): string[] =>
  keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];

export const mostRecentFirst = (keys: readonly string[], key: string): string[] =>
  [key, ...keys.filter((k) => k !== key)].slice(0, RECENT_LIMIT);

export function registryMarks(state: vscode.Memento): RegistryMarks {
  const listeners = new Set<() => void>();
  const read = (name: string) => state.get<readonly string[]>(name, []);
  const write = async (name: string, keys: readonly string[]) => {
    await state.update(name, keys);
    for (const listener of [...listeners]) listener();
  };
  return {
    favourites: () => read(FAVOURITES),
    recents: () => read(RECENTS),
    toggleFavourite: (key) => write(FAVOURITES, toggled(read(FAVOURITES), key)),
    placed: (key) => write(RECENTS, mostRecentFirst(read(RECENTS), key)),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
