// The root's Terraform files as the developer sees them: an editor can hold
// changes the disk does not have yet. A command that writes the root's
// Terraform (Generate, Format, Convert) saves them first, so it writes over
// what the developer sees.
import type * as vscode from 'vscode';
import { type AuthoringRoot, rootUri } from '../roots/authoring-roots';

// Saves the root's Terraform files that have unsaved changes in an editor.
// False when one of them did not save.
export async function saveTerraformBuffers(
  workspace: Pick<typeof vscode.workspace, 'textDocuments'>,
  root: AuthoringRoot,
): Promise<boolean> {
  const under = `${rootUri(root).toString()}/`;
  const dirty = workspace.textDocuments.filter(
    (document) =>
      document.isDirty &&
      document.uri.path.endsWith('.tf') &&
      document.uri.toString().startsWith(under),
  );
  const saved = await Promise.all(dirty.map((document) => document.save()));
  return saved.every(Boolean);
}
