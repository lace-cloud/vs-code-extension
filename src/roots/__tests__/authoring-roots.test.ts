import { describe, expect, test, vi } from 'vitest';
import {
  type AuthoringRoot,
  fileUri,
  nameRoot,
  type RootSources,
  rootAt,
  rootLabel,
  rootOfPath,
  rootPath,
  rootsHolding,
  rootToAct,
  startModule,
  workspaceRootSources,
} from '../authoring-roots';
import { folder, uri } from './fake-uri';

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };

function sources(over: Partial<RootSources> = {}): RootSources {
  return {
    folders: () => [repo],
    activeCanvas: () => undefined,
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
    expect(rootLabel(root!)).toBe('infra/prod');
  });

  test('the workspace folder itself is the root with an empty path, labelled by its name', () => {
    const root = rootAt([repo], uri('/work/repo'));
    expect(root).toEqual({ folder: repo, relative: '' });
    expect(rootLabel(root!)).toBe('repo');
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

  test('none when no directory holds Terraform, and says so', async () => {
    const pick = vi.fn();
    expect(await nameRoot(sources({ pick }))).toEqual({ kind: 'noTerraform' });
    expect(pick).not.toHaveBeenCalled();
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
      activeTerraformDirectory: () => undefined,
      terraformFiles: async () => [uri('/work/repo/a/main.tf'), uri('/work/repo/b/main.tf')],
    };
    expect(await rootToAct(asking, said, 'validate')).toBeUndefined();
    expect(said.showInformationMessage).toHaveBeenCalledWith(
      'No module to validate: several directories hold Terraform files (a, b). Open the canvas of one, or point at its folder in the Explorer.',
    );
  });

  test('with no folder open, says to open one first', async () => {
    const said = window();
    expect(await rootToAct(sources({ folders: () => [] }), said, 'validate')).toBeUndefined();
    expect(said.showInformationMessage).toHaveBeenCalledWith(
      'No module to validate: no folder is open. Open the folder that holds the module first.',
    );
  });

  test('with no directory holding Terraform, says so and how a module starts', async () => {
    const said = window();
    expect(await rootToAct(sources(), said, 'validate')).toBeUndefined();
    expect(said.showInformationMessage).toHaveBeenCalledWith(
      'No module to validate: no directory under this workspace holds Terraform files. Start one with Lace: Open Canvas on its folder in the Explorer.',
    );
  });
});

describe('the directories that hold Terraform', () => {
  test("exclude Terraform's cache and Lace's state directory", () => {
    const roots = rootsHolding(
      [repo],
      [
        uri('/work/repo/infra/prod/main.tf'),
        uri('/work/repo/infra/prod/.terraform/modules/vpc/main.tf'),
        uri('/work/repo/infra/prod/.lace/.canvas/main.tf'),
        uri('/work/repo/.terraform/modules/x/main.tf'),
      ],
    );
    expect(roots.map((r) => r.relative)).toEqual(['infra/prod']);
  });

  test('span every workspace folder, in folder order', () => {
    const other = folder('/work/other', 1);
    const roots = rootsHolding(
      [repo, other],
      [uri('/work/other/main.tf'), uri('/work/repo/a/b/main.tf')],
    );
    expect(roots.map((r) => [r.folder.name, r.relative])).toEqual([
      ['repo', 'a/b'],
      ['other', ''],
    ]);
  });
});

describe('the sources VS Code supplies', () => {
  function api(activePath: string | undefined) {
    return {
      workspace: {
        workspaceFolders: [repo],
        findFiles: vi.fn(async () => [uri('/work/repo/infra/prod/main.tf')]),
        openTextDocument: vi.fn(async (opened: unknown) => ({ opened })),
      },
      window: {
        activeTextEditor: activePath ? { document: { uri: uri(activePath) } } : undefined,
        showQuickPick: vi.fn(),
        showTextDocument: vi.fn(),
      },
    };
  }
  // The fakes carry only what the module reads.
  const sourcesOf = (fake: ReturnType<typeof api>) =>
    workspaceRootSources(fake as never, () => undefined);

  test('the active editor names a directory only when its file is Terraform', () => {
    expect(sourcesOf(api('/work/repo/infra/prod/main.tf')).activeTerraformDirectory()?.path).toBe(
      '/work/repo/infra/prod',
    );
    expect(sourcesOf(api('/work/repo/README.md')).activeTerraformDirectory()).toBeUndefined();
    expect(sourcesOf(api(undefined)).activeTerraformDirectory()).toBeUndefined();
  });

  test("the search is one glob that skips Terraform's cache and Lace's state", async () => {
    const fake = api(undefined);
    await sourcesOf(fake).terraformFiles();
    expect(fake.workspace.findFiles).toHaveBeenCalledWith('**/*.tf', '**/{.terraform,.lace}/**');
  });

  test('starting a module opens an untitled main.tf in the root and writes nothing', async () => {
    const fake = api(undefined);
    await startModule(fake as never, prod);
    const [opened] = fake.workspace.openTextDocument.mock.calls[0] as unknown as [
      { scheme: string; path: string },
    ];
    expect(opened.scheme).toBe('untitled');
    expect(opened.path).toBe('/work/repo/infra/prod/main.tf');
    expect(fake.window.showTextDocument).toHaveBeenCalledTimes(1);
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
