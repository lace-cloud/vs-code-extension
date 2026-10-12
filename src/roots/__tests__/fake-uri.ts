// A stand-in for `vscode.Uri` over file paths, enough for code that only
// reads a URI's parts and derives another with `with`.
import type * as vscode from 'vscode';

type Parts = { scheme: string; authority: string; path: string };

export function uri(path: string, scheme = 'file', authority = ''): vscode.Uri {
  const parts: Parts = { scheme, authority, path };
  const made = {
    ...parts,
    query: '',
    fragment: '',
    fsPath: path,
    with: (change: Partial<Parts>) =>
      uri(change.path ?? path, change.scheme ?? scheme, change.authority ?? authority),
    toString: () => `${scheme}://${authority}${path}`,
    toJSON: () => parts,
  };
  return made;
}

export function folder(path: string, index = 0): vscode.WorkspaceFolder {
  return { uri: uri(path), name: path.split('/').pop() ?? path, index };
}
