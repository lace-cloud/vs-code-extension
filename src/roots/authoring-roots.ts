// Authoring roots: which module directory a surface acts on, how one is
// chosen, and the one name it is called by (`rootLabel`). An authoring root
// is a directory under a workspace folder — a repository whose Terraform
// sits in `infra/prod` has its root there, and a workspace can hold
// several. A module that starts on the canvas has its root in a directory
// that holds no Terraform until its first Generate.
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
// A Terraform file is one the Lace CLI reads as Terraform: `.tf` or
// `.tf.json`.
const TERRAFORM_EXTENSIONS = ['tf', 'tf.json'];
const TERRAFORM_FILES = `**/*.{${TERRAFORM_EXTENSIONS.join(',')}}`;
const NOT_AUTHORED_FILES = `**/{${NOT_AUTHORED.join(',')}}/**`;

export function isTerraformFile(path: string): boolean {
  return TERRAFORM_EXTENSIONS.some((extension) => path.endsWith(`.${extension}`));
}

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

// The root's path in the workspace: its path under its folder, with the
// folder's name first in a workspace of several folders, so two folders'
// roots of one path are told apart. The folder itself, in a workspace of one
// folder, is `''`: `rootLabel` calls it by the folder's name, and a tool's
// `root` spells it `.`.
export function workspacePath(
  root: AuthoringRoot,
  folders: readonly vscode.WorkspaceFolder[],
): string {
  return folders.length > 1 ? posix.join(root.folder.name, root.relative) : root.relative;
}

// The directory a path in the workspace names, read as `workspacePath`
// spells one: under the folder whose name comes first in a workspace of
// several folders, else under the one folder. Undefined when no folder has
// that name.
export function workspaceDirectory(
  folders: readonly vscode.WorkspaceFolder[],
  path: string,
): vscode.Uri | undefined {
  const [name, ...below] = path.split('/');
  const [folder, under] =
    folders.length > 1
      ? [folders.find((each) => each.name === name), below.join('/')]
      : [folders[0], path];
  return folder && fileUri({ folder, relative: '' }, under);
}

// Whether the root's workspace folder is among `folders`. A folder removed
// from the workspace leaves its roots under no open folder, while a canvas
// tab of one of them stays open.
export function folderOpen(
  root: AuthoringRoot,
  folders: readonly vscode.WorkspaceFolder[],
): boolean {
  const { uri } = root.folder;
  return folders.some((folder) => folder.uri.toString() === uri.toString());
}

// The one name of a root, which the module commands, the canvas tab, the
// Stacks view and the tools' results call it by: its path in the workspace,
// with the folder's name first in a workspace of several folders, and the
// folder's name for a workspace folder itself. A root whose folder has left
// the workspace is under no folder's name, and is named by its directory's
// full path.
//
// A tool's `root` input has a grammar of its own over the same path
// (`rootName` in the tools), which keeps `.` for the folder of a workspace
// of one folder: a tool call's invocation message echoes the `root` the
// model gave, and a `root` that names no module directory is answered with
// the candidates in that grammar, `.` among them, since the model passes
// them back as `root`.
export function rootLabel(root: AuthoringRoot, folders: readonly vscode.WorkspaceFolder[]): string {
  if (!folderOpen(root, folders)) return rootPath(root);
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

// What finding a root, asking nothing, found: the root, or why there is
// none.
export type Found =
  | { kind: 'root'; root: AuthoringRoot }
  // Several roots are candidates, and nothing asks which.
  | { kind: 'several'; roots: readonly AuthoringRoot[] }
  // No folder is open in the window.
  | { kind: 'noFolder' }
  // No directory under the workspace holds Terraform and no canvas is open.
  | { kind: 'noModule' };

// What naming a root found: the root, or why there is none. The reason is
// data: `unnamedText` says what each one means to the developer. Naming
// gives `noModule` only for sources that cannot start a module.
export type Named =
  | Found
  // The developer dismissed the pick among several roots.
  | { kind: 'dismissed' }
  // The directory is under no workspace folder.
  | { kind: 'outsideWorkspace'; directory: vscode.Uri }
  // The directory is one a module does not author (`name`, `.terraform` or
  // `.lace`), or `inside` one; `path` is its path under its workspace folder.
  | { kind: 'notAuthored'; path: string; name: string; inside: boolean };

// What a directory pointed at is: the root under the innermost workspace
// folder that contains it, whether or not it holds Terraform, or why it is
// none.
export function placeOf(folders: readonly vscode.WorkspaceFolder[], directory: vscode.Uri): Named {
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

// The root a run names: the directory its context's `root` names, as
// `rootPath` spells it. Undefined for a context that names none, or a
// directory under no folder.
export function rootOfRun(
  folders: readonly vscode.WorkspaceFolder[],
  ctx: { readonly root?: string },
): AuthoringRoot | undefined {
  return ctx.root === undefined ? undefined : rootOfPath(folders, ctx.root);
}

const depth = (root: AuthoringRoot): number =>
  root.relative === '' ? 0 : root.relative.split('/').length;

// The roots a set of Terraform files names: each file's directory. No file
// is read.
function rootsHolding(
  folders: readonly vscode.WorkspaceFolder[],
  terraformFiles: readonly vscode.Uri[],
): AuthoringRoot[] {
  return terraformFiles.flatMap((file) => {
    const root = rootAt(folders, file.with({ path: posix.dirname(file.path) }));
    return root ? [root] : [];
  });
}

// Asks the developer which of several roots; undefined when dismissed.
type Ask = (roots: readonly AuthoringRoot[]) => Promise<AuthoringRoot | undefined>;

// What naming a root reads from its host.
export type RootSources = {
  folders: () => readonly vscode.WorkspaceFolder[];
  // The root of the canvas panel that has focus, when one has.
  activeCanvas: () => AuthoringRoot | undefined;
  // The roots of the canvas panels open in this window, focused or not.
  openCanvases: () => readonly AuthoringRoot[];
  // The directory of the active editor's file, when that file is Terraform.
  activeTerraformDirectory: () => vscode.Uri | undefined;
  // Every Terraform file a module could author, across the workspace.
  terraformFiles: () => Promise<readonly vscode.Uri[]>;
  // Asks which of several candidates. Sources with no `pick` ask nothing.
  pick?: Ask;
  // Asks which of several workspace folders a module starts in, where no
  // directory holds Terraform and no canvas is open; undefined when
  // dismissed. Sources with no `start` start no module: there they name
  // none.
  start?: Ask;
};

// The sources of a surface that starts a module where the workspace holds
// none.
export type StartingSources = RootSources & { start: Ask };

// The roots naming chooses among when nothing names one: the directories
// holding Terraform and the roots of the canvases open in this window, each
// once, shallowest first in folder order. A canvas whose folder has left the
// workspace is under no open folder, so it is no root to choose.
export async function candidates(
  sources: Pick<RootSources, 'folders' | 'openCanvases' | 'terraformFiles'>,
): Promise<AuthoringRoot[]> {
  const folders = sources.folders();
  const holding = rootsHolding(folders, await sources.terraformFiles());
  const open = sources.openCanvases().filter((root) => folderOpen(root, folders));
  const once = new Map<string, AuthoringRoot>();
  for (const root of [...holding, ...open]) {
    once.set(rootUri(root).toString(), root);
  }
  return [...once.values()].sort(
    (a, b) =>
      a.folder.index - b.folder.index ||
      depth(a) - depth(b) ||
      a.relative.localeCompare(b.relative),
  );
}

// What a set of roots names by itself: its sole root, or several.
const among = (roots: readonly AuthoringRoot[]): Extract<Found, { kind: 'root' | 'several' }> =>
  roots.length === 1 ? { kind: 'root', root: roots[0] } : { kind: 'several', roots };

// The root named among `found`: the sole root without asking; among several,
// the one `ask` picks, and none when there is no `ask`.
async function asked(
  found: Extract<Found, { kind: 'root' | 'several' }>,
  ask: Ask | undefined,
): Promise<Named> {
  if (found.kind === 'root' || ask === undefined) return found;
  const picked = await ask(found.roots);
  return picked === undefined ? { kind: 'dismissed' } : { kind: 'root', root: picked };
}

// What naming finds in a window with no folder open, whatever it looks for:
// no root, and why. `name` reads the folders of a window that has one.
function inFolders<T>(
  sources: Pick<RootSources, 'folders'>,
  name: (folders: readonly vscode.WorkspaceFolder[]) => T,
): T | { kind: 'noFolder' } {
  const folders = sources.folders();
  return folders.length === 0 ? { kind: 'noFolder' } : name(folders);
}

// The root found when nothing is pointed at, asking nothing: the active
// canvas's root, when its folder is open (a canvas whose folder has left
// the workspace is no root); else the directory of the active Terraform
// file; else the one of the candidates `known` reads, which it reads only
// then. When it finds none it says why: no folder is open, several roots
// are candidates, or none is.
export async function findRoot(
  sources: Pick<RootSources, 'folders' | 'activeCanvas' | 'activeTerraformDirectory'>,
  known: () => Promise<readonly AuthoringRoot[]>,
): Promise<Found> {
  return inFolders(sources, async (folders): Promise<Found> => {
    const canvas = sources.activeCanvas();
    if (canvas && folderOpen(canvas, folders)) return { kind: 'root', root: canvas };

    const directory = sources.activeTerraformDirectory();
    const edited = directory && rootAt(folders, directory);
    if (edited) return { kind: 'root', root: edited };

    const found = await known();
    return found.length === 0 ? { kind: 'noModule' } : among(found);
  });
}

// The one function every surface calls to learn which root it acts on: the
// directory the developer pointed at; else the root `findRoot` finds, or the
// developer's pick among several candidates; else, when there is no
// candidate and the sources start a module, the workspace's one folder, or
// the developer's pick among its folders. When nothing names a root it says
// why: no folder is open, the directory pointed at is outside every
// workspace folder or is or is inside `.terraform` or `.lace`, there is no
// candidate and the sources start no module, several are candidates and the
// sources have no pick to ask, or the pick was dismissed.
export async function nameRoot(sources: RootSources, pointedAt?: vscode.Uri): Promise<Named> {
  if (pointedAt) return inFolders(sources, (folders) => placeOf(folders, pointedAt));
  const found = await findRoot(sources, () => candidates(sources));
  if (found.kind === 'several') return asked(found, sources.pick);
  if (found.kind === 'noModule' && sources.start) {
    const folders = sources.folders().map((folder) => ({ folder, relative: '' }));
    return asked(among(folders), sources.start);
  }
  return found;
}

// What the developer is told when nothing names a root to `verb`: what is
// true of the reason. A dismissed pick was the developer's own choice, and
// says nothing.
function unnamedText(
  unnamed: Exclude<Named, { kind: 'root' }>,
  folders: readonly vscode.WorkspaceFolder[],
  verb: string,
): string | undefined {
  switch (unnamed.kind) {
    case 'dismissed':
      return undefined;
    case 'noFolder':
      return `No module to ${verb}: no folder is open. Open the folder that holds the module first.`;
    case 'noModule':
      return `No module to ${verb}: no directory under this workspace holds Terraform files and no canvas is open. Start one with Lace: Open Canvas.`;
    case 'several':
      return `No module to ${verb}: several directories hold a module (${unnamed.roots.map((root) => rootLabel(root, folders)).join(', ')}). Open the canvas of one, or point at its folder in the Explorer.`;
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
  const text = unnamedText(named, sources.folders(), verb);
  if (text !== undefined) void window.showInformationMessage(text);
  return undefined;
}

type RootsApi = {
  workspace: Pick<typeof vscode.workspace, 'workspaceFolders' | 'findFiles'>;
  window: Pick<typeof vscode.window, 'activeTextEditor' | 'showQuickPick'>;
};

// Asks the developer which of the roots, a quick pick under `placeHolder`
// listing each root by its name among the workspace's `folders`.
function askAmong(
  window: Pick<typeof vscode.window, 'showQuickPick'>,
  folders: RootSources['folders'],
  placeHolder: string,
): Ask {
  return async (roots) => {
    const named = folders();
    const picked = await window.showQuickPick(
      roots.map((root) => ({ label: rootLabel(root, named), root })),
      { placeHolder },
    );
    return picked?.root;
  };
}

// The sources as VS Code supplies them, with the canvas panels' roots.
export function workspaceRootSources(
  api: RootsApi,
  canvases: Pick<RootSources, 'activeCanvas' | 'openCanvases'>,
): RootSources {
  const folders = () => api.workspace.workspaceFolders ?? [];
  return {
    folders,
    activeCanvas: canvases.activeCanvas,
    openCanvases: canvases.openCanvases,
    activeTerraformDirectory: () => {
      const uri = api.window.activeTextEditor?.document.uri;
      if (!uri || !isTerraformFile(uri.path)) return undefined;
      return uri.with({ path: posix.dirname(uri.path) });
    },
    terraformFiles: async () => api.workspace.findFiles(TERRAFORM_FILES, NOT_AUTHORED_FILES),
    pick: askAmong(api.window, folders, 'Which module?'),
  };
}

// `sources` for a surface that starts a module where the workspace holds
// none: they ask which workspace folder it starts in.
export function startingSources(
  window: Pick<typeof vscode.window, 'showQuickPick'>,
  sources: RootSources,
): StartingSources {
  return {
    ...sources,
    start: askAmong(window, sources.folders, 'Which folder does the module start in?'),
  };
}
