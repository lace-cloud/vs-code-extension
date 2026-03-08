import type { WorkspaceState } from '../../webview/types/workspace';
import type { Module } from '../../webview/types/ir';
import type { ToolResult } from '../types';
import { allChildren } from '../../webview/utils/children';

export type EntryModule = { entryKey: string; mod: Module };

export function getEntryModule(state: WorkspaceState): EntryModule | undefined {
  const entryKey = state.entry;
  const mod = state.modules[entryKey];
  return mod ? { entryKey, mod } : undefined;
}

export function findChildInEntry(state: WorkspaceState, childId: string) {
  const entry = getEntryModule(state);
  if (!entry) return undefined;
  return allChildren(entry.mod).find((c) => c.id === childId);
}

export async function loadGraphState(
  requestGraphState: () => Promise<WorkspaceState>,
): Promise<{ state: WorkspaceState } | { error: ToolResult }> {
  try {
    return { state: await requestGraphState() };
  } catch (err: any) {
    return { error: { content: `Cannot read canvas: ${err.message}`, isError: true } };
  }
}

export function requireEntry(
  state: WorkspaceState,
): { entry: EntryModule } | { error: ToolResult } {
  const entry = getEntryModule(state);
  if (!entry) {
    return { error: { content: 'Canvas has no composite graph.', isError: true } };
  }
  return { entry };
}
