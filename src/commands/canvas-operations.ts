// Save and Generate of a root's canvas, one rule each whichever trigger
// runs them: the palette's Lace: Save and Lace: Generate, or the chat tools.
// The trigger passes what it does on the session; the rule decides whether
// and where that runs. Whether this window holds a root's session is
// answered here too (`held`), for Save's rule and for where a report lands.
//
//   save      on the root's open session, held for the call. A root with no
//             session open in this window holds no unsaved edit, so nothing
//             is saved.
//   generate  the root's Terraform files with unsaved changes in an editor
//             are saved first, so Generate checks the tree the developer
//             sees; then on a hold for the call, the root's open session or
//             a new one, with no tab.
import type * as vscode from 'vscode';
import type { RootHold, RootSessions } from '../engine/root-sessions';
import {
  type AuthoringRoot,
  rootLabel,
  rootOfPath,
  rootPath,
  sameRoot,
} from '../roots/authoring-roots';
import { saveTerraformBuffers } from './terraform-buffers';

export type Operated<T> =
  | { kind: 'done'; value: T }
  // Save: the root has no open canvas, so it holds no unsaved edit.
  | { kind: 'noOpenCanvas' }
  // Generate: one of the root's Terraform files did not save.
  | { kind: 'bufferNotSaved' };

// What a trigger does on the session, through the hold.
export type OnSession<T> = (hold: RootHold) => Promise<T>;

export type CanvasOperations = {
  save: <T>(root: AuthoringRoot, saving: OnSession<T>) => Promise<Operated<T>>;
  generate: <T>(root: AuthoringRoot, generating: OnSession<T>) => Promise<Operated<T>>;
  // Whether this window holds the root's session: its canvas is open, or a
  // call holds it.
  held: (root: AuthoringRoot) => boolean;
};

export type CanvasOperationsOptions = {
  workspace: Pick<typeof vscode.workspace, 'textDocuments' | 'workspaceFolders'>;
  rootSessions: Pick<RootSessions, 'acquire' | 'held'>;
};

// What an operation that did not run says, for the developer and for the
// developer's coding assistant alike.
export function notDoneText(
  root: AuthoringRoot,
  outcome: Exclude<Operated<unknown>, { kind: 'done' }>,
): string {
  const label = rootLabel(root);
  return outcome.kind === 'noOpenCanvas'
    ? `${label} has no open canvas, so it holds no unsaved edits: nothing was saved.`
    : `A Terraform file in ${label} did not save, so Lace did not generate it.`;
}

export function canvasOperations(options: CanvasOperationsOptions): CanvasOperations {
  const { workspace, rootSessions } = options;

  async function holding<T>(root: AuthoringRoot, use: OnSession<T>): Promise<Operated<T>> {
    const hold = await rootSessions.acquire(rootPath(root));
    try {
      return { kind: 'done', value: await use(hold) };
    } finally {
      await hold.release();
    }
  }

  // A held session names its root by the path its first holder spelled.
  // That path is read back as the root it names under the workspace
  // folders, so a root is compared with a root, never one spelling of a
  // path with another.
  function held(root: AuthoringRoot): boolean {
    const folders = workspace.workspaceFolders ?? [];
    return rootSessions.held().some((session) => {
      const named = rootOfPath(folders, session.root);
      return named !== undefined && sameRoot(named, root);
    });
  }

  return {
    held,
    async save(root, saving) {
      return held(root) ? holding(root, saving) : { kind: 'noOpenCanvas' };
    },
    async generate(root, generating) {
      if (!(await saveTerraformBuffers(workspace, root))) return { kind: 'bufferNotSaved' };
      return holding(root, generating);
    },
  };
}
