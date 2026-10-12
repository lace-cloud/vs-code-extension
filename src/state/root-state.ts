// What the window keeps per authoring root beside its session: the stack
// picked for it and its canvas arrangement. This module is their one owner.
// The Stacks tree picks the stack and the root's canvas reads it as
// `context.stack`, the stack whose badges it draws; the canvas page keeps
// its arrangement here. Kept in the window's `workspaceState`, per developer
// and per machine, one record per root keyed on the root's URI.
import type { StackRef } from '@lace-cloud/canvas/engine';
import type { CanvasArrangement } from '@lace-cloud/proto';
import type * as vscode from 'vscode';
import { type AuthoringRoot, rootUri, sameRoot } from '../roots/authoring-roots';

const ROOTS = 'lace.roots';
const NO_ARRANGEMENT: CanvasArrangement = {};

type Kept = { stack?: StackRef; arrangement?: CanvasArrangement };

export type RootState = {
  // The stack picked for `root`, when one is.
  stack: (root: AuthoringRoot) => StackRef | undefined;
  pickStack: (root: AuthoringRoot, stack: StackRef) => Promise<void>;
  // `listener` is called with each pick for `root`, after it is kept.
  onDidPickStack: (root: AuthoringRoot, listener: (stack: StackRef) => void) => () => void;
  arrangement: (root: AuthoringRoot) => CanvasArrangement;
  arrange: (root: AuthoringRoot, arrangement: CanvasArrangement) => Promise<void>;
};

export function createRootState(state: vscode.Memento): RootState {
  const listeners = new Set<{ root: AuthoringRoot; listener: (stack: StackRef) => void }>();
  const all = () => state.get<Record<string, Kept>>(ROOTS, {});
  const kept = (root: AuthoringRoot): Kept => all()[rootUri(root).toString()] ?? {};
  const keep = (root: AuthoringRoot, change: Kept): Thenable<void> =>
    state.update(ROOTS, { ...all(), [rootUri(root).toString()]: { ...kept(root), ...change } });
  return {
    stack: (root) => kept(root).stack,
    async pickStack(root, stack) {
      await keep(root, { stack: { id: stack.id, slug: stack.slug } });
      for (const each of [...listeners]) if (sameRoot(each.root, root)) each.listener(stack);
    },
    onDidPickStack(root, listener) {
      const each = { root, listener };
      listeners.add(each);
      return () => listeners.delete(each);
    },
    arrangement: (root) => kept(root).arrangement ?? NO_ARRANGEMENT,
    arrange: async (root, arrangement) => {
      await keep(root, { arrangement });
    },
  };
}
