// Authoring roots: which module directory a surface acts on, and how one is
// chosen. An authoring root is a directory under a workspace folder — a
// repository whose Terraform sits in `infra/prod` has its root there, and a
// workspace can hold several.
//
// A root is carried as its workspace folder plus its path under that folder,
// never as one absolute path: every URI handed to VS Code is the folder's own
// URI extended by that path, so it keeps the spelling VS Code opened the
// folder with. A URI built from another spelling of the same directory (a
// resolved symlink) is a different file to VS Code: a diagnostic on it does
// not attach to the open document, and opening it adds a second editor.
import { isAbsolute, posix, relative, sep } from 'node:path';
import type * as vscode from 'vscode';

export type AuthoringRoot = {
  folder: vscode.WorkspaceFolder;
  // The root's path under its folder, '/'-separated; '' is the folder itself.
  relative: string;
};

// Directories that hold Terraform a module does not author: the provider and
// module cache `terraform init` fills, and Lace's own state directory.
const NOT_AUTHORED = ['.terraform', '.lace'];
const TERRAFORM_FILES = '**/*.tf';
const NOT_AUTHORED_FILES = `**/{${NOT_AUTHORED.join(',')}}/**`;

export function rootUri(root: AuthoringRoot): vscode.Uri {
  return fileUri(root, '');
}

// The URI of a file named relative to the root.
export function fileUri(root: AuthoringRoot, file: string): vscode.Uri {
  const { uri } = root.folder;
  return uri.with({ path: posix.join(uri.path, root.relative, file) });
}

// The directory as the engine is told it: the folder's own spelling. The
// engine resolves two spellings of one directory to one session.
export function rootPath(root: AuthoringRoot): string {
  return rootUri(root).fsPath;
}

// What a surface calls the root: its path under the workspace folder, or the
// folder's name when the root is the folder.
export function rootLabel(root: AuthoringRoot): string {
  return root.relative === '' ? root.folder.name : root.relative;
}

// The root's path in the workspace: its path under its folder, with the
// folder's name first in a workspace of several folders, so two folders'
// roots of one path are told apart. The folder itself, in a workspace of one
// folder, is `''`; each surface names it in its own way.
export function workspacePath(
  root: AuthoringRoot,
  folders: readonly vscode.WorkspaceFolder[],
): string {
  return folders.length > 1 ? posix.join(root.folder.name, root.relative) : root.relative;
}

// What the root's canvas tab is titled: its path in the workspace, the
// folder's name for the folder itself.
export function rootTitle(root: AuthoringRoot, folders: readonly vscode.WorkspaceFolder[]): string {
  const path = workspacePath(root, folders);
  return path === '' ? root.folder.name : path;
}

export function sameRoot(a: AuthoringRoot, b: AuthoringRoot): boolean {
  return rootUri(a).toString() === rootUri(b).toString();
}

function under(folder: vscode.WorkspaceFolder, uri: vscode.Uri): boolean {
  const { scheme, authority, path } = folder.uri;
  if (uri.scheme !== scheme || uri.authority !== authority) return false;
  return uri.path === path || uri.path.startsWith(path.endsWith('/') ? path : `${path}/`);
}

// What naming a root found: the root, or why there is none. The reason is
// data: `unnamedText` says what each one means to the developer.
export type Named =
  | { kind: 'root'; root: AuthoringRoot }
  // The developer dismissed the pick among several roots.
  | { kind: 'dismissed' }
  // Several directories hold Terraform, and nothing asks which.
  | { kind: 'several'; roots: readonly AuthoringRoot[] }
  // No folder is open in the window.
  | { kind: 'noFolder' }
  // No directory under the workspace holds Terraform.
  | { kind: 'noTerraform' }
  // The directory is under no workspace folder.
  | { kind: 'outsideWorkspace'; directory: vscode.Uri }
  // The directory is one a module does not author (`name`, `.terraform` or
  // `.lace`), or `inside` one; `path` is its path under its workspace folder.
  | { kind: 'notAuthored'; path: string; name: string; inside: boolean };

// What a directory is: the root under the innermost workspace folder that
// contains it, or why it is none.
function placeOf(folders: readonly vscode.WorkspaceFolder[], directory: vscode.Uri): Named {
  const [folder] = folders
    .filter((candidate) => under(candidate, directory))
    .sort((a, b) => b.uri.path.length - a.uri.path.length);
  if (!folder) return { kind: 'outsideWorkspace', directory };
  const relative = posix.relative(folder.uri.path, directory.path);
  const segments = relative.split('/');
  const at = segments.findIndex((segment) => NOT_AUTHORED.includes(segment));
  if (at >= 0) {
    return {
      kind: 'notAuthored',
      path: relative,
      name: segments[at],
      inside: at < segments.length - 1,
    };
  }
  return { kind: 'root', root: { folder, relative } };
}

// The root a directory is; undefined when it is none.
export function rootAt(
  folders: readonly vscode.WorkspaceFolder[],
  directory: vscode.Uri,
): AuthoringRoot | undefined {
  const placed = placeOf(folders, directory);
  return placed.kind === 'root' ? placed.root : undefined;
}

// The root a directory path names, as `rootPath` spells it: read against
// each folder's own path, so a folder on any scheme (a remote one among
// them) gives back its own URI. Undefined for a path under no folder.
export function rootOfPath(
  folders: readonly vscode.WorkspaceFolder[],
  path: string,
): AuthoringRoot | undefined {
  const [innermost] = folders
    .map((folder) => ({ folder, below: relative(folder.uri.fsPath, path) }))
    .filter(({ below }) => !isAbsolute(below) && below !== '..' && !below.startsWith(`..${sep}`))
    .sort((a, b) => a.below.length - b.below.length);
  if (!innermost) return undefined;
  return { folder: innermost.folder, relative: innermost.below.split(sep).join('/') };
}

const depth = (root: AuthoringRoot): number =>
  root.relative === '' ? 0 : root.relative.split('/').length;

// The roots a set of Terraform files names: each file's directory, once,
// shallowest first. No file is read.
export function rootsHolding(
  folders: readonly vscode.WorkspaceFolder[],
  terraformFiles: readonly vscode.Uri[],
): AuthoringRoot[] {
  const roots = new Map<string, AuthoringRoot>();
  for (const file of terraformFiles) {
    const root = rootAt(folders, file.with({ path: posix.dirname(file.path) }));
    if (!root) continue;
    roots.set(rootUri(root).toString(), root);
  }
  return [...roots.values()].sort(
    (a, b) =>
      a.folder.index - b.folder.index ||
      depth(a) - depth(b) ||
      a.relative.localeCompare(b.relative),
  );
}

// What naming a root reads from its host.
export type RootSources = {
  folders: () => readonly vscode.WorkspaceFolder[];
  // The root of the canvas panel that has focus, when one has.
  activeCanvas: () => AuthoringRoot | undefined;
  // The directory of the active editor's file, when that file is Terraform.
  activeTerraformDirectory: () => vscode.Uri | undefined;
  // Every Terraform file a module could author, across the workspace.
  terraformFiles: () => Promise<readonly vscode.Uri[]>;
  // Asks the developer which of several roots; undefined when dismissed.
  // Sources with no `pick` ask nothing.
  pick?: (roots: readonly AuthoringRoot[]) => Promise<AuthoringRoot | undefined>;
};

// The one function every surface calls to learn which root it acts on: the
// directory the developer pointed at; else the active canvas's root; else
// the directory of the active Terraform file; else the one directory in the
// workspace that holds Terraform, or the developer's pick among several.
// When nothing names a root it says why: no folder is open, the directory
// pointed at is outside every workspace folder or is or is inside
// `.terraform` or `.lace`, no directory holds Terraform, several do and the
// sources have no pick to ask, or the pick was dismissed.
export async function nameRoot(sources: RootSources, pointedAt?: vscode.Uri): Promise<Named> {
  const folders = sources.folders();
  if (folders.length === 0) return { kind: 'noFolder' };
  if (pointedAt) return placeOf(folders, pointedAt);

  const canvas = sources.activeCanvas();
  if (canvas) return { kind: 'root', root: canvas };

  const directory = sources.activeTerraformDirectory();
  const edited = directory && rootAt(folders, directory);
  if (edited) return { kind: 'root', root: edited };

  const candidates = rootsHolding(folders, await sources.terraformFiles());
  if (candidates.length === 0) return { kind: 'noTerraform' };
  if (candidates.length === 1) return { kind: 'root', root: candidates[0] };
  if (sources.pick === undefined) return { kind: 'several', roots: candidates };
  const picked = await sources.pick(candidates);
  return picked === undefined ? { kind: 'dismissed' } : { kind: 'root', root: picked };
}

// What the developer is told when nothing names a root to `verb`: what is
// true of the reason. A dismissed pick was the developer's own choice, and
// says nothing.
function unnamedText(unnamed: Exclude<Named, { kind: 'root' }>, verb: string): string | undefined {
  switch (unnamed.kind) {
    case 'dismissed':
      return undefined;
    case 'noFolder':
      return `No module to ${verb}: no folder is open. Open the folder that holds the module first.`;
    case 'noTerraform':
      return `No module to ${verb}: no directory under this workspace holds Terraform files. Start one with Lace: Open Canvas on its folder in the Explorer.`;
    case 'several':
      return `No module to ${verb}: several directories hold Terraform files (${unnamed.roots.map(rootLabel).join(', ')}). Open the canvas of one, or point at its folder in the Explorer.`;
    case 'outsideWorkspace':
      return `No module to ${verb}: ${unnamed.directory.fsPath} is outside the folders of this workspace.`;
    case 'notAuthored':
      return unnamed.inside
        ? `No module to ${verb}: ${unnamed.path} is inside ${unnamed.name}, which is not a module directory.`
        : `No module to ${verb}: ${unnamed.path} is a ${unnamed.name} directory, which is not a module directory.`;
  }
}

// The root a command acts on, as `nameRoot` names it. When it names none,
// the developer is told why, unless they dismissed the pick themselves.
export async function rootToAct(
  sources: RootSources,
  window: Pick<typeof vscode.window, 'showInformationMessage'>,
  verb: string,
  pointedAt?: vscode.Uri,
): Promise<AuthoringRoot | undefined> {
  const named = await nameRoot(sources, pointedAt);
  if (named.kind === 'root') return named.root;
  const text = unnamedText(named, verb);
  if (text !== undefined) void window.showInformationMessage(text);
  return undefined;
}

type RootsApi = {
  workspace: Pick<typeof vscode.workspace, 'workspaceFolders' | 'findFiles'>;
  window: Pick<typeof vscode.window, 'activeTextEditor' | 'showQuickPick'>;
};

// The sources as VS Code supplies them.
export function workspaceRootSources(
  api: RootsApi,
  activeCanvas: () => AuthoringRoot | undefined,
): RootSources {
  return {
    folders: () => api.workspace.workspaceFolders ?? [],
    activeCanvas,
    activeTerraformDirectory: () => {
      const uri = api.window.activeTextEditor?.document.uri;
      if (!uri?.path.endsWith('.tf')) return undefined;
      return uri.with({ path: posix.dirname(uri.path) });
    },
    terraformFiles: async () => api.workspace.findFiles(TERRAFORM_FILES, NOT_AUTHORED_FILES),
    pick: async (roots) => {
      const picked = await api.window.showQuickPick(
        roots.map((root) => ({
          label: rootLabel(root),
          description: root.relative === '' ? undefined : root.folder.name,
          root,
        })),
        { placeHolder: 'Which module?' },
      );
      return picked?.root;
    },
  };
}
