// A stand-in for `vscode.Uri`, enough for code that reads a URI's parts and
// derives another with `with`. Its `fsPath` is derived from its path as VS
// Code derives one on the OS the test runs on: a drive letter lower-cased,
// and on Windows every `/` a `\`. `toString` is the URI's identity, its parts
// as given.
import { posix } from 'node:path';
import type * as vscode from 'vscode';

const WINDOWS = process.platform === 'win32';

type Parts = { scheme: string; authority: string; path: string };

function fsPathOf(path: string): string {
  const drive = /^\/[a-zA-Z]:/.test(path) ? `${path[1].toLowerCase()}${path.slice(2)}` : path;
  return WINDOWS ? drive.replaceAll('/', '\\') : drive;
}

export function uri(path: string, scheme = 'file', authority = ''): vscode.Uri {
  const parts: Parts = { scheme, authority, path };
  const made = {
    ...parts,
    query: '',
    fragment: '',
    fsPath: fsPathOf(path),
    with: (change: Partial<Parts>) =>
      uri(change.path ?? path, change.scheme ?? scheme, change.authority ?? authority),
    toString: () => `${scheme}://${authority}${path}`,
    toJSON: () => parts,
  };
  return made;
}

// `vscode.Uri.file`: the URI of a path on disk. On Windows the path's `\`
// are `/` in the URI, and a drive's path starts with `/`.
export function file(path: string): vscode.Uri {
  const slashed = WINDOWS ? path.replaceAll('\\', '/') : path;
  return uri(slashed.startsWith('/') ? slashed : `/${slashed}`);
}

// A path on disk as VS Code spells it on the OS the test runs on:
// `Uri.file(path).fsPath`.
export const fsPath = (path: string): string => file(path).fsPath;

// The workspace folder of a directory on disk, named as VS Code names one:
// by the directory's name.
export function folder(path: string, index = 0): vscode.WorkspaceFolder {
  const at = file(path);
  return { uri: at, name: posix.basename(at.path), index };
}
