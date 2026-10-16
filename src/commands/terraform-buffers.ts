// The root's Terraform files as the developer sees them: an editor can hold
// changes the disk does not have yet. Whatever writes the root's Terraform
// saves them first, so it writes over what the developer sees: Generate,
// and each CLI command the CLI declares a rewrite (`COMMANDS[path].effect`),
// which are Format, Convert and Import Existing Resources's `stack import`.
import { COMMANDS, type CommandPath } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { type AuthoringRoot, isTerraformFile, rootUri } from '../roots/authoring-roots';

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
      isTerraformFile(document.uri.path) &&
      document.uri.toString().startsWith(under),
  );
  const saved = await Promise.all(dirty.map((document) => document.save()));
  return saved.every(Boolean);
}

// Before `lace <path>` runs in `root`: saves the root's Terraform buffers
// when the CLI declares the command a rewrite, and saves nothing before any
// other command, which reads the files as they are on disk. False when a
// buffer did not save.
export async function saveBuffersBefore(
  workspace: Pick<typeof vscode.workspace, 'textDocuments'>,
  root: AuthoringRoot,
  path: CommandPath,
): Promise<boolean> {
  return COMMANDS[path].effect !== 'rewrite' || saveTerraformBuffers(workspace, root);
}
