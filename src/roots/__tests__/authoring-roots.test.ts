import { describe, expect, test, vi } from 'vitest';
import {
  type AuthoringRoot,
  candidates,
  fileUri,
  findRoot,
  nameRoot,
  type RootSources,
  rootAt,
  rootLabel,
  rootOfPath,
  rootPath,
  rootToAct,
  rootUri,
  startingSources,
  workspaceDirectory,
  workspacePath,
  workspaceRootSources,
} from '../authoring-roots';
import { folder, uri } from './fake-uri';

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };

function sources(over: Partial<RootSources> = {}): RootSources {
  return {
    folders: () => [repo],
    activeCanvas: () => undefined,
    openCanvases: () => [],
    activeTerraformDirectory: () => undefined,
    terraformFiles: async () => [],
    pick: async () => undefined,
    ...over,
  };
}

describe('a root is a directory under a workspace folder', () => {
  test('a module in infra/prod has its root there, not at the workspace folder', () => {
    const root = rootAt([repo], uri('/work/repo/infra/prod'));
    expect(root).toEqual({ folder: repo, relative: 'infra/prod' });
    expect(rootPath(root!)).toBe('/work/repo/infra/prod');
    expect(rootLabel(root!, [repo])).toBe('infra/prod');
  });

  test('the workspace folder itself is the root with an empty path, labelled by its name', () => {
    const root = rootAt([repo], uri('/work/repo'));
    expect(root).toEqual({ folder: repo, relative: '' });
    expect(rootLabel(root!, [repo])).toBe('repo');
  });

  test("in a workspace of several folders a root is named by its path in the workspace, the folder's name first", () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    expect(rootLabel({ folder: api, relative: 'infra/prod' }, [api, web])).toBe('api/infra/prod');
    expect(rootLabel({ folder: web, relative: '' }, [api, web])).toBe('web');
  });

  test("a root whose folder has left the workspace is named by its directory's full path", () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    expect(rootLabel({ folder: web, relative: 'infra/prod' }, [api])).toBe('/work/web/infra/prod');
    expect(rootLabel({ folder: web, relative: '' }, [api])).toBe('/work/web');
    expect(rootLabel({ folder: web, relative: 'infra/prod' }, [])).toBe('/work/web/infra/prod');
  });

  test('a directory outside every workspace folder is no root', () => {
    expect(rootAt([repo], uri('/work/repository'))).toBeUndefined();
    expect(rootAt([repo], uri('/elsewhere'))).toBeUndefined();
    expect(rootAt([repo], uri('/work/repo/infra', 'vscode-vfs'))).toBeUndefined();
  });

  test("a directory inside Terraform's cache or Lace's state is no root", () => {
    expect(rootAt([repo], uri('/work/repo/infra/.terraform/modules/net'))).toBeUndefined();
    expect(rootAt([repo], uri('/work/repo/.terraform'))).toBeUndefined();
    expect(rootAt([repo], uri('/work/repo/infra/.lace/cache'))).toBeUndefined();
  });

  test('a directory under nested workspace folders belongs to the innermost', () => {
    const inner = folder('/work/repo/infra', 1);
    expect(rootAt([repo, inner], uri('/work/repo/infra/prod'))).toEqual({
      folder: inner,
      relative: 'prod',
    });
  });
});

describe('a path in the workspace', () => {
  const other = folder('/work/other', 1);
  const roots: AuthoringRoot[] = [
    { folder: repo, relative: '' },
    { folder: repo, relative: 'infra/prod' },
    { folder: other, relative: '' },
    { folder: other, relative: 'infra' },
  ];

  test('names the directory `workspacePath` spells, in a workspace of one folder or of several', () => {
    for (const folders of [[repo], [repo, other]]) {
      for (const root of roots.filter((each) => folders.includes(each.folder))) {
        const named = workspaceDirectory(folders, workspacePath(root, folders));
        expect(named?.toString()).toBe(rootUri(root).toString());
      }
    }
  });

  test('names no directory under a folder name the workspace does not have', () => {
    expect(workspaceDirectory([repo, other], 'elsewhere/infra')).toBeUndefined();
    expect(workspaceDirectory([], 'infra')).toBeUndefined();
  });
});

describe('a path handed to VS Code', () => {
  test("is the workspace folder's URI plus the root's path plus the file", () => {
    // The folder is a symlink VS Code opened as /work/link; a file URI keeps
    // that spelling whatever the directory resolves to.
    const link = folder('/work/link');
    const file = fileUri({ folder: link, relative: 'infra/prod' }, 'network/main.tf');
    expect(file.path).toBe('/work/link/infra/prod/network/main.tf');
    expect(file.scheme).toBe('file');
  });
});

describe('naming a root', () => {
  const canvas: AuthoringRoot = { folder: repo, relative: 'canvas' };
  const all = sources({
    activeCanvas: () => canvas,
    activeTerraformDirectory: () => uri('/work/repo/edited'),
    terraformFiles: async () => [uri('/work/repo/picked/main.tf')],
  });
  const rooted = (root: AuthoringRoot) => ({ kind: 'root', root });

  test('the directory pointed at wins', async () => {
    expect(await nameRoot(all, uri('/work/repo/infra/prod'))).toEqual(rooted(prod));
  });

  test('a directory pointed at outside the workspace names none, and says so', async () => {
    expect(await nameRoot(all, uri('/elsewhere'))).toMatchObject({
      kind: 'outsideWorkspace',
      directory: { path: '/elsewhere' },
    });
  });

  test("a directory pointed at that is, or is inside, Terraform's cache or Lace's state names none, and says which", async () => {
    expect(await nameRoot(all, uri('/work/repo/infra/.terraform/modules/net'))).toEqual({
      kind: 'notAuthored',
      path: 'infra/.terraform/modules/net',
      name: '.terraform',
      inside: true,
    });
    expect(await nameRoot(all, uri('/work/repo/infra/.terraform'))).toEqual({
      kind: 'notAuthored',
      path: 'infra/.terraform',
      name: '.terraform',
      inside: false,
    });
    expect(await nameRoot(all, uri('/work/repo/.lace'))).toEqual({
      kind: 'notAuthored',
      path: '.lace',
      name: '.lace',
      inside: false,
    });
  });

  test('with no folder open names none, and says so', async () => {
    const empty = sources({ folders: () => [] });
    expect(await nameRoot(empty)).toEqual({ kind: 'noFolder' });
    expect(await nameRoot(empty, uri('/work/repo/infra'))).toEqual({ kind: 'noFolder' });
  });

  test("else the active canvas's root", async () => {
    expect(await nameRoot(all)).toEqual(rooted(canvas));
  });

  test("else the active Terraform file's directory", async () => {
    const named = await nameRoot({ ...all, activeCanvas: () => undefined });
    expect(named).toEqual(rooted({ folder: repo, relative: 'edited' }));
  });

  test("an active Terraform file inside Terraform's cache names no root, and the search goes on", async () => {
    const named = await nameRoot({
      ...all,
      activeCanvas: () => undefined,
      activeTerraformDirectory: () => uri('/work/repo/infra/.terraform/modules/net'),
    });
    expect(named).toEqual(rooted({ folder: repo, relative: 'picked' }));
  });

  test('else the one directory that holds Terraform, without asking', async () => {
    const pick = vi.fn();
    const named = await nameRoot(
      sources({ terraformFiles: async () => [uri('/work/repo/infra/prod/main.tf')], pick }),
    );
    expect(named).toEqual(rooted(prod));
    expect(pick).not.toHaveBeenCalled();
  });

  const several = async () => [
    uri('/work/repo/infra/prod/main.tf'),
    uri('/work/repo/infra/prod/variables.tf'),
    uri('/work/repo/main.tf'),
    uri('/work/repo/infra/main.tf'),
  ];

  test('else the pick among several, shallowest first', async () => {
    const pick = vi.fn(async (roots: readonly AuthoringRoot[]) => roots[1]);
    const named = await nameRoot(sources({ terraformFiles: several, pick }));
    expect(pick.mock.calls[0][0].map((r) => r.relative)).toEqual(['', 'infra', 'infra/prod']);
    expect(named).toEqual(rooted({ folder: repo, relative: 'infra' }));
  });

  test('a dismissed pick names none, and says the developer dismissed it', async () => {
    expect(await nameRoot(sources({ terraformFiles: several }))).toEqual({ kind: 'dismissed' });
  });

  test('sources with no pick ask nothing: among several, none is named, and it says there are several', async () => {
    const asking: RootSources = {
      folders: () => [repo],
      activeCanvas: () => undefined,
      openCanvases: () => [],
      activeTerraformDirectory: () => undefined,
      terraformFiles: several,
    };
    expect(await nameRoot(asking)).toEqual({
      kind: 'several',
      roots: [
        { folder: repo, relative: '' },
        { folder: repo, relative: 'infra' },
        { folder: repo, relative: 'infra/prod' },
      ],
    });
  });

  test('none when no directory holds Terraform, no canvas is open and the sources start no module, and says so', async () => {
    const pick = vi.fn();
    expect(await nameRoot(sources({ pick }))).toEqual({ kind: 'noModule' });
    expect(pick).not.toHaveBeenCalled();
  });

  const infraNew: AuthoringRoot = { folder: repo, relative: 'infra/new' };

  test('an open canvas on a directory with no Terraform is a candidate: alone it is named without asking, and no module is started', async () => {
    const pick = vi.fn();
    const start = vi.fn();
    const named = await nameRoot(sources({ openCanvases: () => [infraNew], pick, start }));
    expect(named).toEqual(rooted(infraNew));
    expect(pick).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test('an unfocused canvas on infra/new beside the Terraform of infra/prod gives a pick of the two, each once', async () => {
    const pick = vi.fn(async (roots: readonly AuthoringRoot[]) => roots[1]);
    const named = await nameRoot(
      sources({
        openCanvases: () => [infraNew, prod],
        terraformFiles: async () => [uri('/work/repo/infra/prod/main.tf')],
        pick,
      }),
    );
    expect(pick.mock.calls[0][0]).toEqual([infraNew, prod]);
    expect(named).toEqual(rooted(prod));
  });
});

describe('a module started where the workspace holds none', () => {
  const rooted = (root: AuthoringRoot) => ({ kind: 'root', root });
  const other = folder('/work/other', 1);

  test("where no directory holds Terraform, sources that can start a module name the workspace's one folder, without asking", async () => {
    const start = vi.fn();
    expect(await nameRoot(sources({ start }))).toEqual(rooted({ folder: repo, relative: '' }));
    expect(start).not.toHaveBeenCalled();
  });

  test('in a workspace of several folders, the developer picks the folder it starts in, in folder order', async () => {
    const start = vi.fn(async (roots: readonly AuthoringRoot[]) => roots[1]);
    const named = await nameRoot(sources({ folders: () => [repo, other], start }));
    expect(start.mock.calls[0][0]).toEqual([
      { folder: repo, relative: '' },
      { folder: other, relative: '' },
    ]);
    expect(named).toEqual(rooted({ folder: other, relative: '' }));
  });

  test('a dismissed pick of the folder names none, and says the developer dismissed it', async () => {
    const start = vi.fn(async () => undefined);
    expect(await nameRoot(sources({ folders: () => [repo, other], start }))).toEqual({
      kind: 'dismissed',
    });
  });

  test('where a directory holds Terraform, no folder is a candidate and nothing is asked about one', async () => {
    const start = vi.fn();
    const named = await nameRoot(
      sources({ terraformFiles: async () => [uri('/work/repo/infra/prod/main.tf')], start }),
    );
    expect(named).toEqual(rooted(prod));
    expect(start).not.toHaveBeenCalled();
  });

  test('with no folder open names none, and says so', async () => {
    const start = vi.fn();
    expect(await nameRoot(sources({ folders: () => [], start }))).toEqual({ kind: 'noFolder' });
    expect(start).not.toHaveBeenCalled();
  });

  test("a folder on a remote scheme starts the module at the folder's own URI", async () => {
    const remote = { ...repo, uri: uri('/work/repo', 'vscode-remote', 'ssh-remote+host') };
    const named = await nameRoot(sources({ folders: () => [remote], start: vi.fn() }));
    expect(named.kind === 'root' && fileUri(named.root, 'main.tf').toString()).toBe(
      'vscode-remote://ssh-remote+host/work/repo/main.tf',
    );
  });

  test('finding a root asks nothing: no pick among several and no folder to start in', async () => {
    const pick = vi.fn();
    const start = vi.fn();
    const twoModules = async () => [uri('/work/repo/a/main.tf'), uri('/work/repo/b/main.tf')];
    const finding = (over: Partial<RootSources>) => {
      const read = sources({ ...over, pick, start });
      return findRoot(read, () => candidates(read));
    };
    expect(await finding({ terraformFiles: twoModules })).toEqual({
      kind: 'several',
      roots: [
        { folder: repo, relative: 'a' },
        { folder: repo, relative: 'b' },
      ],
    });
    expect(await finding({ folders: () => [repo, other] })).toEqual({ kind: 'noModule' });
    expect(pick).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test('finding a root reads the candidates only when the focus names none', async () => {
    const known = vi.fn(async () => [prod]);
    const canvas: AuthoringRoot = { folder: repo, relative: 'canvas' };
    expect(await findRoot(sources({ activeCanvas: () => canvas }), known)).toEqual({
      kind: 'root',
      root: canvas,
    });
    expect(known).not.toHaveBeenCalled();
    expect(await findRoot(sources(), known)).toEqual({ kind: 'root', root: prod });
    expect(known).toHaveBeenCalledOnce();
    expect(await findRoot(sources({ folders: () => [] }), known)).toEqual({ kind: 'noFolder' });
    expect(known).toHaveBeenCalledOnce();
  });

  test("the starting sources ask among the workspace's folders by name", async () => {
    const window = {
      showQuickPick: vi.fn(async (items: readonly { root: AuthoringRoot }[]) => items[1]),
    };
    const starting = startingSources(window as never, sources({ folders: () => [repo, other] }));
    const named = await nameRoot(starting);
    expect(window.showQuickPick).toHaveBeenCalledWith(
      [
        { label: 'repo', root: { folder: repo, relative: '' } },
        { label: 'other', root: { folder: other, relative: '' } },
      ],
      { placeHolder: 'Which folder does the module start in?' },
    );
    expect(named).toEqual(rooted({ folder: other, relative: '' }));
  });
});

describe('the root a command acts on', () => {
  const window = () => ({ showInformationMessage: vi.fn(async () => undefined) });

  test('is the root named, with nothing said', async () => {
    const said = window();
    expect(await rootToAct(sources(), said, 'open', uri('/work/repo/infra/prod'))).toEqual(prod);
    expect(said.showInformationMessage).not.toHaveBeenCalled();
  });

  test('a dismissed pick is the developer’s own choice: nothing is acted on and nothing is said', async () => {
    const said = window();
    const several = async () => [uri('/work/repo/a/main.tf'), uri('/work/repo/b/main.tf')];
    expect(await rootToAct(sources({ terraformFiles: several }), said, 'validate')).toBeUndefined();
    expect(said.showInformationMessage).not.toHaveBeenCalled();
  });

  test.each([
    [
      "a folder inside Terraform's cache",
      uri('/work/repo/infra/.terraform/modules/net'),
      'No module to open: infra/.terraform/modules/net is inside .terraform, which is not a module directory.',
    ],
    [
      "a folder inside Lace's state",
      uri('/work/repo/infra/.lace/cache'),
      'No module to open: infra/.lace/cache is inside .lace, which is not a module directory.',
    ],
    [
      "Terraform's cache itself",
      uri('/work/repo/infra/.terraform'),
      'No module to open: infra/.terraform is a .terraform directory, which is not a module directory.',
    ],
    [
      "Lace's state itself",
      uri('/work/repo/infra/.lace'),
      'No module to open: infra/.lace is a .lace directory, which is not a module directory.',
    ],
    [
      'a folder outside the workspace',
      uri('/elsewhere'),
      'No module to open: /elsewhere is outside the folders of this workspace.',
    ],
  ])('%s is named for what it is', async (_case, pointedAt, text) => {
    const said = window();
    expect(await rootToAct(sources(), said, 'open', pointedAt)).toBeUndefined();
    expect(said.showInformationMessage).toHaveBeenCalledWith(text);
  });

  test('among several with no pick to ask, names them', async () => {
    const said = window();
    const asking: RootSources = {
      folders: () => [repo],
      activeCanvas: () => undefined,
      openCanvases: () => [],
      activeTerraformDirectory: () => undefined,
      terraformFiles: async () => [uri('/work/repo/a/main.tf'), uri('/work/repo/b/main.tf')],
    };
    expect(await rootToAct(asking, said, 'validate')).toBeUndefined();
    expect(said.showInformationMessage).toHaveBeenCalledWith(
      'No module to validate: several directories hold a module (a, b). Open the canvas of one, or point at its folder in the Explorer.',
    );
  });

  test('with no folder open, says to open one first', async () => {
    const said = window();
    expect(await rootToAct(sources({ folders: () => [] }), said, 'validate')).toBeUndefined();
    expect(said.showInformationMessage).toHaveBeenCalledWith(
      'No module to validate: no folder is open. Open the folder that holds the module first.',
    );
  });

  test('with no directory holding Terraform and no canvas open, says so and how a module starts', async () => {
    const said = window();
    expect(await rootToAct(sources(), said, 'validate')).toBeUndefined();
    expect(said.showInformationMessage).toHaveBeenCalledWith(
      'No module to validate: no directory under this workspace holds Terraform files and no canvas is open. Start one with Lace: Open Canvas.',
    );
  });
});

describe('the candidates', () => {
  const candidatesOf = (
    folders: readonly ReturnType<typeof folder>[],
    files: readonly string[],
    open: readonly AuthoringRoot[] = [],
  ) =>
    candidates({
      folders: () => folders,
      openCanvases: () => open,
      terraformFiles: async () => files.map((path) => uri(path)),
    });

  test("are the directories that hold Terraform, excluding Terraform's cache and Lace's state directory", async () => {
    const roots = await candidatesOf(
      [repo],
      [
        '/work/repo/infra/prod/main.tf',
        '/work/repo/infra/prod/.terraform/modules/vpc/main.tf',
        '/work/repo/infra/prod/.lace/.canvas/main.tf',
        '/work/repo/.terraform/modules/x/main.tf',
      ],
    );
    expect(roots.map((r) => r.relative)).toEqual(['infra/prod']);
  });

  test('span every workspace folder, in folder order', async () => {
    const other = folder('/work/other', 1);
    const roots = await candidatesOf(
      [repo, other],
      ['/work/other/main.tf', '/work/repo/a/b/main.tf'],
    );
    expect(roots.map((r) => [r.folder.name, r.relative])).toEqual([
      ['repo', 'a/b'],
      ['other', ''],
    ]);
  });

  test('leave out an open canvas whose folder has left the workspace', async () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    const roots = await candidatesOf(
      [api],
      ['/work/api/infra/prod/main.tf', '/work/web/infra/prod/main.tf'],
      [{ folder: web, relative: 'infra/prod' }],
    );
    expect(roots).toEqual([{ folder: api, relative: 'infra/prod' }]);
  });

  test('take in the roots of the canvases open, focused or not, each once, shallowest first', async () => {
    const roots = await candidatesOf(
      [repo],
      ['/work/repo/infra/prod/main.tf'],
      [prod, { folder: repo, relative: 'infra/new/eu' }, { folder: repo, relative: '' }],
    );
    expect(roots.map((r) => r.relative)).toEqual(['', 'infra/prod', 'infra/new/eu']);
  });
});

describe('the sources VS Code supplies', () => {
  function api(activePath: string | undefined, workspaceFolders = [repo]) {
    return {
      workspace: {
        workspaceFolders,
        findFiles: vi.fn(async () => [uri('/work/repo/infra/prod/main.tf')]),
      },
      window: {
        activeTextEditor: activePath ? { document: { uri: uri(activePath) } } : undefined,
        showQuickPick: vi.fn(),
      },
    };
  }
  // The fakes carry only what the module reads.
  const sourcesOf = (fake: ReturnType<typeof api>) =>
    workspaceRootSources(fake as never, {
      activeCanvas: () => undefined,
      openCanvases: () => [],
    });

  test('the active editor names a directory only when its file is Terraform, .tf or .tf.json as the CLI reads it', () => {
    expect(sourcesOf(api('/work/repo/infra/prod/main.tf')).activeTerraformDirectory()?.path).toBe(
      '/work/repo/infra/prod',
    );
    expect(
      sourcesOf(api('/work/repo/infra/json/main.tf.json')).activeTerraformDirectory()?.path,
    ).toBe('/work/repo/infra/json');
    expect(sourcesOf(api('/work/repo/README.md')).activeTerraformDirectory()).toBeUndefined();
    expect(sourcesOf(api('/work/repo/package.json')).activeTerraformDirectory()).toBeUndefined();
    expect(sourcesOf(api(undefined)).activeTerraformDirectory()).toBeUndefined();
  });

  test("the search is one glob over .tf and .tf.json files that skips Terraform's cache and Lace's state", async () => {
    const fake = api(undefined);
    await sourcesOf(fake).terraformFiles();
    expect(fake.workspace.findFiles).toHaveBeenCalledWith(
      '**/*.{tf,tf.json}',
      '**/{.terraform,.lace}/**',
    );
  });

  test('the pick among several modules asks which module', async () => {
    const fake = api(undefined);
    await sourcesOf(fake).pick?.([prod]);
    expect(fake.window.showQuickPick).toHaveBeenCalledWith([{ label: 'infra/prod', root: prod }], {
      placeHolder: 'Which module?',
    });
  });

  test("the pick lists two folders' roots of one path by their names", async () => {
    const backend = folder('/work/api', 0);
    const frontend = folder('/work/web', 1);
    const fake = api(undefined, [backend, frontend]);
    const roots: AuthoringRoot[] = [
      { folder: backend, relative: 'infra' },
      { folder: frontend, relative: 'infra' },
    ];
    await sourcesOf(fake).pick?.(roots);
    expect(fake.window.showQuickPick).toHaveBeenCalledWith(
      [
        { label: 'api/infra', root: roots[0] },
        { label: 'web/infra', root: roots[1] },
      ],
      { placeHolder: 'Which module?' },
    );
  });
});

describe('the root a directory path names', () => {
  const nested = folder('/work/repo/infra', 1);

  test('is the directory under the innermost folder holding it, inverse to rootPath', () => {
    const root = rootOfPath([repo, nested], '/work/repo/infra/prod');
    expect(root).toEqual({ folder: nested, relative: 'prod' });
    expect(root && rootPath(root)).toBe('/work/repo/infra/prod');
    expect(rootOfPath([repo], '/work/repo')).toEqual({ folder: repo, relative: '' });
  });

  test("keeps the folder's own URI, on any scheme", () => {
    const remote = { ...repo, uri: uri('/work/repo', 'vscode-remote', 'ssh-remote+host') };
    const root = rootOfPath([remote], '/work/repo/infra/prod');
    expect(root && fileUri(root, 'main.tf').toString()).toBe(
      'vscode-remote://ssh-remote+host/work/repo/infra/prod/main.tf',
    );
  });

  test('is undefined for a path under no folder', () => {
    expect(rootOfPath([repo], '/work/other')).toBeUndefined();
    expect(rootOfPath([repo], '/work/repository')).toBeUndefined();
  });
});
