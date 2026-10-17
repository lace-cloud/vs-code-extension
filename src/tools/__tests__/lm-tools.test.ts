import { win32 } from 'node:path';
import type { GenerateEvent } from '@lace-cloud/canvas/engine';
import {
  type CanvasToolPorts,
  canvasTools,
  type ModuleToolPorts,
  type ToolRegistration,
} from '@lace-cloud/chat-core';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { CanvasPanels } from '../../canvas/canvas-panels';
import { canvasOperations } from '../../commands/canvas-operations';
import { fakeCommands, HOME, type Scripts } from '../../engine/__tests__/fake-commands';
import type { RootHold } from '../../engine/root-sessions';
import { folder, fsPath, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot } from '../../roots/authoring-roots';
import {
  createLaceTools,
  type LaceTool,
  type LaceToolPorts,
  type LanguageModelApi,
  registerLaceTools,
  rootName,
  rootNamed,
  TOOL_SCHEMAS,
  UnknownRoot,
} from '../lm-tools';
import {
  fakeCancellation,
  fakeRootSessions,
  fakeSession,
  settled,
  VALIDATED,
} from './fake-session';

// What a chat-core handler was handed: its tool's name, its input and the
// call's signal.
type Handled = { tool: string; input: Record<string, unknown>; signal: AbortSignal | undefined };
const handled = vi.hoisted((): Handled[] => []);

// chat-core's own tool sets, recorded: each canvas tool set made and what it
// returned, and what every handler of either set is handed.
vi.mock('@lace-cloud/chat-core', async (actual) => {
  const chatCore = await actual<typeof import('@lace-cloud/chat-core')>();
  const recording = (registration: ToolRegistration) => {
    const { schema, handler } = registration;
    registration.handler = (input, signal) => {
      handled.push({ tool: schema.name, input, signal });
      return handler(input, signal);
    };
  };
  return {
    ...chatCore,
    canvasTools: vi.fn((ports: CanvasToolPorts) => {
      const set = chatCore.canvasTools(ports);
      set.forEach(recording);
      return set;
    }),
    moduleTools: vi.fn((ports: ModuleToolPorts) => {
      const set = chatCore.moduleTools(ports);
      set.forEach(recording);
      return set;
    }),
  };
});

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };

const NAMES = TOOL_SCHEMAS.map((schema) => schema.name);

// VS Code's file system as `stat` reads it: a directory at each of
// `directories`, and nothing anywhere else.
const DIRECTORY = 2;
class FileSystemError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const fileSystem = (directories: readonly string[]) => ({
  stat: async (at: vscode.Uri) => {
    if (directories.includes(at.path)) return { type: DIRECTORY, ctime: 0, mtime: 0, size: 0 };
    throw new FileSystemError('FileNotFound');
  },
});

const DELETE_DB = { changes: [{ operation: 'delete', instance: 'db' }] };
const RENAME_APP = { changes: [{ operation: 'rename', instance: 'app', value: 'frontend' }] };

// The canvas a call's result ends with lists each instance as `- <name>:`.
const instancesIn = (content: string): string[] =>
  [...content.matchAll(/^- (\w+): module/gm)].map(([, name]) => name);

// `scripts`: commands scripted beyond the validate and registry listing
// every call can make; `fake`: the root's session; `folders`: the
// workspace's folders.
function setUp(
  scripts: Scripts = {},
  fake = fakeSession(),
  folders: readonly vscode.WorkspaceFolder[] = [repo],
) {
  const { rootSessions, acquired, holders, renew } = fakeRootSessions(fake.session);
  const order: string[] = [];
  rootSessions.acquire.mockImplementation(
    ((acquire) => async (root: string) => {
      order.push('acquire');
      return acquire(root);
    })(rootSessions.acquire.getMockImplementation()!),
  );
  // The canvas panel holds the session from the panel's creation on.
  const panelHolds: RootHold[] = [];
  const panels = {
    ensure: vi.fn(async (root: AuthoringRoot, options?: { preserveFocus?: boolean }) => {
      order.push('ensure');
      panelHolds.push(await rootSessions.acquire(`${root.folder.uri.path}/${root.relative}`));
      return { root, options } as unknown as Awaited<ReturnType<CanvasPanels['ensure']>>;
    }),
  };
  const lace = fakeCommands({
    'module validate': { documents: [VALIDATED] },
    'registry list': {
      documents: [
        {
          items: [],
          truncated: false,
          publishingGuideUrl: 'https://lace.example/docs/registry-publishing',
        },
      ],
    },
    ...scripts,
  });
  const commands = { at: vi.fn(lace.commands.at), anywhere: vi.fn(lace.commands.anywhere) };
  // The editors' documents: what a Generate saves first.
  const textDocuments: { uri: vscode.Uri; isDirty: boolean; save: () => Promise<boolean> }[] = [];
  const ports: LaceToolPorts = {
    panels,
    rootSessions,
    operations: canvasOperations({
      workspace: { workspaceFolders: folders, textDocuments } as never,
      rootSessions,
    }),
    commands,
  };
  const laceTools = createLaceTools(ports, { folders: () => folders });
  const tool = (name: string): LaceTool => {
    const found = laceTools.find((each) => each.schema.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  return {
    fake,
    ports,
    panels,
    commands,
    acquired,
    holders,
    renew,
    order,
    tool,
    lace,
    textDocuments,
    // The canvas tab closes, giving its hold back.
    closePanel: () => Promise.all(panelHolds.splice(0).map((hold) => hold.release())),
  };
}

describe('the tools', () => {
  test('are the seven tools of chat-core, in its order', () => {
    expect(NAMES).toEqual([
      'lace_change_module_canvas',
      'lace_describe_module_canvas',
      'lace_save_module_canvas',
      'lace_generate_module_terraform',
      'lace_validate_module_terraform',
      'lace_search_module_registry',
      'lace_describe_registry_module',
    ]);
    const { tool } = setUp();
    expect(NAMES.map((name) => tool(name).schema.name)).toEqual(NAMES);
  });

  test('the change tool reveals the root canvas without focus, then holds the session for the call', async () => {
    const { tool, panels, order, holders, fake } = setUp();
    const result = await tool('lace_change_module_canvas').call(prod, DELETE_DB);
    expect(result.content).toContain('Change 1: applied. deleted db.');
    expect(panels.ensure).toHaveBeenCalledWith(prod, { preserveFocus: true });
    expect(order).toEqual(['ensure', 'acquire', 'acquire']);
    expect(fake.editor.apply).toHaveBeenCalledOnce();
    // The call released its own hold; the panel's stays.
    expect(holders()).toBe(1);
  });

  test('two consecutive changes see each other', async () => {
    const { tool } = setUp();
    const change = tool('lace_change_module_canvas');
    const renamed = await change.call(prod, RENAME_APP);
    expect(renamed.content).toContain('renamed app to frontend');
    const deleted = await change.call(prod, {
      changes: [{ operation: 'delete', instance: 'frontend' }],
    });
    expect(deleted.content).toContain('Change 1: applied. deleted frontend.');
  });

  test.each([
    'lace_describe_module_canvas',
    'lace_generate_module_terraform',
  ])('%s holds the session for the call and opens no tab', async (name) => {
    const { tool, panels, acquired, holders } = setUp();
    const result = await tool(name).call(prod, {});
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Canvas of module');
    expect(panels.ensure).not.toHaveBeenCalled();
    expect(acquired).toEqual([fsPath('/work/repo/infra/prod')]);
    expect(holders()).toBe(0);
  });

  test("generate saves the root's dirty Terraform buffers, then writes the Terraform", async () => {
    const { tool, fake, textDocuments } = setUp();
    const buffer = { uri: uri('/work/repo/infra/prod/main.tf'), isDirty: true, save: vi.fn() };
    buffer.save.mockImplementation(async () => {
      expect(fake.editor.generate).not.toHaveBeenCalled();
      return true;
    });
    textDocuments.push(buffer);
    const result = await tool('lace_generate_module_terraform').call(prod, {});
    expect(buffer.save).toHaveBeenCalledOnce();
    expect(fake.editor.generate).toHaveBeenCalledOnce();
    expect(result.content).toContain('Generated the Terraform. Changed main.tf.');
  });

  test('generate with a buffer that did not save generates nothing and says so', async () => {
    const { tool, fake, textDocuments, acquired } = setUp();
    textDocuments.push({
      uri: uri('/work/repo/infra/prod/main.tf'),
      isDirty: true,
      save: async () => false,
    });
    const result = await tool('lace_generate_module_terraform').call(prod, {});
    expect(result).toEqual({
      content: 'A Terraform file in infra/prod did not save, so Lace did not generate it.',
      isError: true,
    });
    expect(acquired).toEqual([]);
    expect(fake.editor.generate).not.toHaveBeenCalled();
  });

  test('save on a root with no session says there is nothing unsaved and opens nothing', async () => {
    const { tool, acquired, fake } = setUp();
    const result = await tool('lace_save_module_canvas').call(prod, {});
    expect(result.content).toBe(
      'infra/prod has no open canvas, so it holds no unsaved edits: nothing was saved.',
    );
    expect(result.isError).toBe(false);
    expect(acquired).toEqual([]);
    expect(fake.editor.save).not.toHaveBeenCalled();
  });

  test('save on a root with no session, in a workspace of several folders, names the root by its path in the workspace', async () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    const { tool } = setUp({}, fakeSession(), [api, web]);
    const result = await tool('lace_save_module_canvas').call(
      { folder: api, relative: 'infra/prod' },
      {},
    );
    expect(result.content).toBe(
      'api/infra/prod has no open canvas, so it holds no unsaved edits: nothing was saved.',
    );
  });

  test("save on a root whose canvas is open saves that canvas's session", async () => {
    const { tool, panels, fake } = setUp();
    await panels.ensure(prod);
    const result = await tool('lace_save_module_canvas').call(prod, {});
    expect(fake.editor.save).toHaveBeenCalledOnce();
    expect(result.content).toContain('Saved the canvas.');
  });

  test('validate runs in the root and the registry tools in the home, none on a session', async () => {
    const { tool, acquired, panels, lace } = setUp();
    const validated = await tool('lace_validate_module_terraform').call(prod, {});
    expect(validated.content).toContain('"verdict":"already-lace-style"');

    const searched = await tool('lace_search_module_registry').call(prod, { query: 'vpc' });
    expect(searched.isError).toBe(false);
    await tool('lace_describe_registry_module').call(prod, { module: 'acme/vpc' });
    expect(lace.invoked.map(({ cwd, path }) => [cwd, path])).toEqual([
      [fsPath('/work/repo/infra/prod'), 'module validate'],
      [HOME, 'registry list'],
      [HOME, 'registry describe'],
    ]);
    expect(lace.invoked[1].args).toMatchObject({ axis: 'module', query: 'vpc' });
    expect(acquired).toEqual([]);
    expect(panels.ensure).not.toHaveBeenCalled();
  });
});

describe("a canvas tool call's tool set", () => {
  test('is made for the call over the ports of the session its hold is on, and nothing is made beside the calls', async () => {
    const { tool, fake, panels } = setUp();
    const made = vi.mocked(canvasTools);
    made.mockClear();
    // The canvas tab holds the session; no tool set is made for it.
    await panels.ensure(prod);
    expect(made).not.toHaveBeenCalled();

    await tool('lace_change_module_canvas').call(prod, RENAME_APP);
    await tool('lace_describe_module_canvas').call(prod, {});
    await tool('lace_save_module_canvas').call(prod, {});
    await tool('lace_generate_module_terraform').call(prod, {});

    expect(made).toHaveBeenCalledTimes(4);
    for (const [ports] of made.mock.calls) {
      expect(ports).toEqual({
        source: fake.session.ports.source,
        editor: fake.session.ports.editor,
        commands: fake.session.ports.commands,
      });
    }
  });

  test('keeps no reader of the session once its call settles', async () => {
    const { tool, fake, holders } = setUp();
    await tool('lace_change_module_canvas').call(prod, RENAME_APP);
    await tool('lace_describe_module_canvas').call(prod, {});
    // The change's canvas tab still holds the session.
    expect(holders()).toBe(1);
    expect(fake.listeners()).toBe(0);
  });

  test("a call after the root's session is opened again runs on the new session", async () => {
    const { tool, renew } = setUp();
    const renamed = await tool('lace_change_module_canvas').call(prod, RENAME_APP);
    expect(instancesIn(renamed.content)).toEqual(['net', 'frontend', 'db']);

    const next = fakeSession('session-2');
    renew(next.session);
    const described = await tool('lace_describe_module_canvas').call(prod, {});
    expect(instancesIn(described.content)).toEqual(['net', 'app', 'db']);
  });

  test('a call under way when the session is opened again finishes on the session it began on', async () => {
    const { tool, fake, renew } = setUp();
    const applying = fake.editor.apply.getMockImplementation();
    if (applying === undefined) throw new Error('the fake session applies nothing');
    let land = () => {};
    fake.editor.apply.mockImplementationOnce(async (actions) => {
      await new Promise<void>((resolve) => (land = resolve));
      return applying(actions);
    });
    const deleting = tool('lace_change_module_canvas').call(prod, DELETE_DB);
    while (fake.editor.apply.mock.calls.length === 0) await settled();

    const next = fakeSession('session-2');
    renew(next.session);
    land();
    const deleted = await deleting;
    expect(deleted.content).toContain('Change 1: applied. deleted db.');
    expect(instancesIn(deleted.content)).toEqual(['net', 'app']);
    expect(next.editor.apply).not.toHaveBeenCalled();
  });
});

describe('the root a tool names', () => {
  const app = folder('/work/app', 0);
  const api = folder('/work/api', 1);
  const files = (...paths: string[]) => paths.map((path) => uri(path));
  // What a tool's `root` is resolved against: the workspace's folders, its
  // Terraform files, the canvases open, and the directories on disk.
  const resolving = (
    folders: readonly vscode.WorkspaceFolder[],
    terraformFiles: readonly vscode.Uri[],
    directories: readonly string[],
    open: readonly AuthoringRoot[] = [],
  ) => ({
    folders: () => folders,
    openCanvases: () => open,
    terraformFiles: async () => terraformFiles,
    isDirectory: async (at: vscode.Uri) => directories.includes(at.path),
  });

  test('is its path in the workspace, `.` for the folder itself', async () => {
    const sources = resolving([app], files('/work/app/main.tf', '/work/app/infra/prod/main.tf'), [
      '/work/app',
      '/work/app/infra/prod',
    ]);
    expect(rootName({ folder: app, relative: '' }, [app])).toBe('.');
    expect(await rootNamed(sources, 'infra/prod')).toEqual({ folder: app, relative: 'infra/prod' });
    expect(await rootNamed(sources, './infra/prod/')).toEqual({
      folder: app,
      relative: 'infra/prod',
    });
    expect(await rootNamed(sources, '.')).toEqual({ folder: app, relative: '' });
    expect(await rootNamed(sources, '/work/app/infra/prod')).toEqual({
      folder: app,
      relative: 'infra/prod',
    });
  });

  test('spelled with Windows separators is the root it spells with `/`', async () => {
    const sources = resolving([app, api], files('/work/api/infra/prod/main.tf'), [
      '/work/api/infra/prod',
    ]);
    const prod: AuthoringRoot = { folder: api, relative: 'infra/prod' };
    for (const given of ['api/infra/prod', './api/infra/prod/', '/work/api/infra/prod']) {
      expect(await rootNamed(sources, given)).toEqual(prod);
      expect(await rootNamed(sources, win32.normalize(given))).toEqual(prod);
    }
  });

  test('names the folder first in a workspace of several folders', async () => {
    const sources = resolving(
      [app, api],
      files('/work/app/infra/main.tf', '/work/api/infra/main.tf'),
      ['/work/app/infra', '/work/api/infra', '/work/api'],
    );
    expect(await rootNamed(sources, 'api/infra')).toEqual({ folder: api, relative: 'infra' });
    expect(await rootNamed(sources, 'app/infra')).toEqual({ folder: app, relative: 'infra' });
    expect(await rootNamed(sources, 'api')).toEqual({ folder: api, relative: '' });
  });

  test('is any directory of the workspace that is there, one that holds no Terraform yet included; one that is not there is an error listing the candidates', async () => {
    const fresh: AuthoringRoot = { folder: app, relative: 'infra/new' };
    const sources = resolving(
      [app],
      files('/work/app/infra/prod/main.tf', '/work/app/.terraform/modules/x/main.tf'),
      ['/work/app', '/work/app/infra/prod', '/work/app/infra/new', '/work/app/infra/empty'],
      [fresh],
    );
    expect(await rootNamed(sources, 'infra/empty')).toEqual({
      folder: app,
      relative: 'infra/empty',
    });
    expect(await rootNamed(sources, '.')).toEqual({ folder: app, relative: '' });

    const refused = rootNamed(sources, 'infra/staging');
    await expect(refused).rejects.toBeInstanceOf(UnknownRoot);
    await expect(refused).rejects.toMatchObject({ roots: ['infra/new', 'infra/prod'] });
    await expect(refused).rejects.toThrow(
      'No module directory of this workspace is named "infra/staging". The directories that hold Terraform or have an open canvas (2): infra/new, infra/prod.',
    );
  });

  test('lists no open canvas whose folder has left the workspace among the candidates', async () => {
    const web = folder('/work/web', 2);
    const sources = resolving(
      [api],
      files('/work/api/infra/prod/main.tf'),
      ['/work/api/infra/prod', '/work/web/infra/prod'],
      [{ folder: web, relative: 'infra/prod' }],
    );
    const refused = rootNamed(sources, 'infra/staging');
    await expect(refused).rejects.toMatchObject({ roots: ['infra/prod'] });
    await expect(refused).rejects.toThrow(
      'The directories that hold Terraform or have an open canvas (1): infra/prod.',
    );
  });

  test("that is, or is inside, Terraform's cache or Lace's state, or is outside the workspace, is an error though the directory is there", async () => {
    const sources = resolving([app], files('/work/app/infra/prod/main.tf'), [
      '/work/app/.terraform/modules/x',
      '/work/app/.lace',
      '/work/other',
    ]);
    for (const given of ['.terraform/modules/x', '.lace', '../other', '/work/other']) {
      await expect(rootNamed(sources, given)).rejects.toMatchObject({ roots: ['infra/prod'] });
    }
  });
});

describe('registration', () => {
  class Result {
    constructor(readonly content: unknown[]) {}
  }
  class TextPart {
    constructor(readonly value: string) {}
  }
  class Cancelled extends Error {}
  const sources = {
    folders: () => [repo],
    openCanvases: () => [],
    terraformFiles: async () => [uri('/work/repo/infra/prod/main.tf')],
  };

  // The API registration reads, over a file system with the workspace's
  // folder and `infra/prod` on disk.
  function language(
    lm: LanguageModelApi['lm'],
    fs: Pick<vscode.FileSystem, 'stat'> = fileSystem(['/work/repo', '/work/repo/infra/prod']),
  ): LanguageModelApi {
    return {
      lm,
      LanguageModelToolResult: Result as unknown as typeof vscode.LanguageModelToolResult,
      LanguageModelTextPart: TextPart as unknown as typeof vscode.LanguageModelTextPart,
      CancellationError: Cancelled as unknown as typeof vscode.CancellationError,
      workspace: { fs },
      FileType: { Directory: DIRECTORY },
      FileSystemError: FileSystemError as unknown as typeof vscode.FileSystemError,
    };
  }

  function registered() {
    const tools = new Map<string, vscode.LanguageModelTool<Record<string, unknown>>>();
    const dispose = vi.fn();
    const registerTool = vi.fn(
      (name: string, tool: vscode.LanguageModelTool<Record<string, unknown>>) => {
        tools.set(name, tool);
        return { dispose };
      },
    );
    return { tools, dispose, registerTool };
  }

  const { token } = fakeCancellation();

  test('registers every tool where the Language Model Tools API exists, and disposes them', () => {
    const { tools, dispose, registerTool } = registered();
    const { ports } = setUp();
    const disposable = registerLaceTools(
      language({ registerTool } as LanguageModelApi['lm']),
      ports,
      sources,
    );
    expect([...tools.keys()]).toEqual(NAMES);

    disposable.dispose();
    expect(dispose).toHaveBeenCalledTimes(NAMES.length);
  });

  test.each([
    ['no `lm` namespace', undefined],
    ['an `lm` namespace without registerTool', {}],
  ])('is skipped on a host with %s', (_name, lm) => {
    const { ports } = setUp();
    const disposable = registerLaceTools(language(lm as LanguageModelApi['lm']), ports, sources);
    expect(() => disposable.dispose()).not.toThrow();
  });

  test('a change VS Code cancels before it applies applies nothing, and the call stops listening once it settles', async () => {
    const { tools, registerTool } = registered();
    // The session's own commands: the registry listing a place reads is held.
    const sessionCommands = fakeCommands({ 'registry list': { held: true } });
    const { ports, fake } = setUp({}, fakeSession('session-1', sessionCommands.port));
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), ports, sources);
    const cancellation = fakeCancellation();

    const call = tools.get('lace_change_module_canvas')?.invoke(
      {
        input: { root: 'infra/prod', changes: [{ operation: 'place', module: 'acme/vpc' }] },
        toolInvocationToken: undefined,
      },
      cancellation.token,
    );
    await vi.waitFor(() => expect(sessionCommands.held).toHaveLength(1));
    expect(cancellation.listening()).toBe(1);
    cancellation.cancel();
    const said = await Promise.resolve(call).then(
      (result) =>
        (result as unknown as Result).content
          .map((part) => (part instanceof TextPart ? part.value : ''))
          .join(''),
      (error: Error) => error.message,
    );

    expect(said).toContain('The call was cancelled before it applied.');
    expect(fake.editor.apply).not.toHaveBeenCalled();
    expect(cancellation.listening()).toBe(0);
  });

  // Each tool, and how its call is made to wait on what it runs: an engine
  // operation that does not settle, or a command held until its signal
  // aborts.
  const waiting: [string, (t: ReturnType<typeof setUp>) => Promise<() => boolean>][] = [
    [
      'lace_save_module_canvas',
      async ({ panels, fake }) => {
        await panels.ensure(prod);
        fake.editor.save.mockImplementationOnce(() => new Promise<void>(() => {}));
        return () => fake.editor.save.mock.calls.length > 0;
      },
    ],
    [
      'lace_generate_module_terraform',
      async ({ fake }) => {
        fake.editor.generate.mockImplementationOnce(async function* () {
          yield* await new Promise<GenerateEvent[]>(() => {});
        });
        return () => fake.editor.generate.mock.calls.length > 0;
      },
    ],
    [
      'lace_validate_module_terraform',
      async ({ lace }) =>
        () =>
          lace.held.length > 0,
    ],
    [
      'lace_search_module_registry',
      async ({ lace }) =>
        () =>
          lace.held.length > 0,
    ],
    [
      'lace_describe_registry_module',
      async ({ lace }) =>
        () =>
          lace.held.length > 0,
    ],
  ];

  test.each(
    waiting,
  )('%s, cancelled while it waits, stops waiting and stops listening', async (name, wait) => {
    const { tools, registerTool } = registered();
    const t = setUp({
      'module validate': { held: true },
      'registry list': { held: true },
      'registry describe': { held: true },
    });
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, sources);
    const reached = await wait(t);
    const cancellation = fakeCancellation();
    handled.splice(0);

    const call = Promise.resolve(
      tools
        .get(name)
        ?.invoke(
          { input: { root: 'infra/prod', module: 'acme/vpc' }, toolInvocationToken: undefined },
          cancellation.token,
        ),
    ).catch((error: Error) => error);
    await vi.waitFor(() => expect(reached()).toBe(true));
    cancellation.cancel();
    await call;

    expect(handled.map(({ tool, signal }) => [tool, signal?.aborted])).toEqual([[name, true]]);
    expect(cancellation.listening()).toBe(0);
  });

  test('describe is handed the call’s signal', async () => {
    const { tools, registerTool } = registered();
    const t = setUp();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, sources);
    const cancellation = fakeCancellation();
    handled.splice(0);
    // The session delivers its frame only once the test says so, so the
    // describe is under way when the call is cancelled.
    const source = t.fake.session.ports.source;
    const subscribe = source.subscribe.bind(source);
    let deliver = () => {};
    source.subscribe = (on, onEnd) => {
      let off = () => {};
      deliver = () => {
        off = subscribe(on, onEnd);
      };
      return () => off();
    };

    const call = tools
      .get('lace_describe_module_canvas')
      ?.invoke(
        { input: { root: 'infra/prod' }, toolInvocationToken: undefined },
        cancellation.token,
      );
    await vi.waitFor(() => expect(handled).toHaveLength(1));
    cancellation.cancel();
    deliver();
    await call;

    expect(handled.map(({ tool, signal }) => [tool, signal?.aborted])).toEqual([
      ['lace_describe_module_canvas', true],
    ]);
  });

  test.each(
    NAMES,
  )('%s, invoked with a token already cancelled, rejects as cancelled and opens, holds and runs nothing', async (name) => {
    const { tools, registerTool } = registered();
    const t = setUp();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, sources);
    // The canvas is open, so a save would have a session to run on.
    await t.panels.ensure(prod);
    t.panels.ensure.mockClear();
    const holds = t.acquired.length;
    const cancellation = fakeCancellation();
    cancellation.cancel();
    handled.splice(0);

    const call = tools.get(name)?.invoke(
      {
        input: { root: 'infra/prod', ...DELETE_DB, query: 'vpc', module: 'acme/vpc' },
        toolInvocationToken: undefined,
      },
      cancellation.token,
    );
    await expect(call).rejects.toBeInstanceOf(Cancelled);
    expect(t.panels.ensure).not.toHaveBeenCalled();
    expect(t.acquired).toHaveLength(holds);
    expect(handled).toEqual([]);
    expect(t.commands.at).not.toHaveBeenCalled();
    expect(t.commands.anywhere).not.toHaveBeenCalled();
    expect(cancellation.listening()).toBe(0);
  });

  test('a change cancelled while its root is being resolved rejects as cancelled, and opens and holds nothing', async () => {
    const { tools, registerTool } = registered();
    const t = setUp();
    // The directory the root names is still being read.
    let found = () => {};
    const reading = {
      stat: () =>
        new Promise<vscode.FileStat>((resolve) => {
          found = () => resolve({ type: DIRECTORY, ctime: 0, mtime: 0, size: 0 });
        }),
    };
    registerLaceTools(
      language({ registerTool } as LanguageModelApi['lm'], reading),
      t.ports,
      sources,
    );
    const cancellation = fakeCancellation();
    handled.splice(0);

    const call = Promise.resolve(
      tools
        .get('lace_change_module_canvas')
        ?.invoke(
          { input: { root: 'infra/prod', ...DELETE_DB }, toolInvocationToken: undefined },
          cancellation.token,
        ),
    );
    call.catch(() => {});
    await settled();
    cancellation.cancel();
    found();

    await expect(call).rejects.toBeInstanceOf(Cancelled);
    expect(t.panels.ensure).not.toHaveBeenCalled();
    expect(t.acquired).toEqual([]);
    expect(handled).toEqual([]);
    expect(cancellation.listening()).toBe(0);
  });

  test.each([
    ['an unknown root', 'nowhere'],
    ['a root that is no string', 7],
  ])('a cancelled call naming %s rejects as cancelled, not with the root’s error', async (_name, root) => {
    const { tools, registerTool } = registered();
    const t = setUp();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, sources);
    const cancellation = fakeCancellation();
    cancellation.cancel();

    const call = tools
      .get('lace_describe_module_canvas')
      ?.invoke({ input: { root }, toolInvocationToken: undefined }, cancellation.token);
    await expect(call).rejects.toBeInstanceOf(Cancelled);
    expect(t.acquired).toEqual([]);
  });

  test('an uncancelled call naming an unknown root still fails with the roots listed', async () => {
    const { tools, registerTool } = registered();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), setUp().ports, sources);
    const call = tools
      .get('lace_describe_module_canvas')
      ?.invoke({ input: { root: 'nowhere' }, toolInvocationToken: undefined }, token);
    await expect(call).rejects.toBeInstanceOf(UnknownRoot);
  });

  test('a describe cancelled while its session is being acquired rejects as cancelled, runs no handler and keeps no hold', async () => {
    const { tools, registerTool } = registered();
    const t = setUp();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, sources);
    const acquire = t.ports.rootSessions.acquire as ReturnType<typeof vi.fn>;
    const acquiring = acquire.getMockImplementation();
    if (acquiring === undefined) throw new Error('the fake root sessions acquire nothing');
    let proceed = () => {};
    acquire.mockImplementationOnce(async (root: string) => {
      await new Promise<void>((resolve) => (proceed = resolve));
      return acquiring(root);
    });
    const cancellation = fakeCancellation();
    handled.splice(0);

    const call = Promise.resolve(
      tools
        .get('lace_describe_module_canvas')
        ?.invoke(
          { input: { root: 'infra/prod' }, toolInvocationToken: undefined },
          cancellation.token,
        ),
    );
    call.catch(() => {});
    await vi.waitFor(() => expect(acquire).toHaveBeenCalled());
    cancellation.cancel();
    proceed();

    await expect(call).rejects.toBeInstanceOf(Cancelled);
    expect(handled).toEqual([]);
    expect(t.holders()).toBe(0);
  });

  test.each([
    ['lace_save_module_canvas', true],
    ['lace_generate_module_terraform', false],
  ])('%s, cancelled while its hold is being taken, rejects as cancelled, runs no handler and gives the hold back', async (name, open) => {
    const { tools, registerTool } = registered();
    const t = setUp();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, sources);
    // Save's rule runs only on a root whose canvas is open.
    if (open) await t.panels.ensure(prod);
    const holders = t.holders();
    const acquire = t.ports.rootSessions.acquire as ReturnType<typeof vi.fn>;
    const acquiring = acquire.getMockImplementation();
    if (acquiring === undefined) throw new Error('the fake root sessions acquire nothing');
    const acquires = acquire.mock.calls.length;
    let proceed = () => {};
    acquire.mockImplementationOnce(async (root: string) => {
      await new Promise<void>((resolve) => (proceed = resolve));
      return acquiring(root);
    });
    const cancellation = fakeCancellation();
    handled.splice(0);

    const call = Promise.resolve(
      tools
        .get(name)
        ?.invoke(
          { input: { root: 'infra/prod' }, toolInvocationToken: undefined },
          cancellation.token,
        ),
    );
    call.catch(() => {});
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(acquires + 1));
    cancellation.cancel();
    proceed();

    await expect(call).rejects.toBeInstanceOf(Cancelled);
    expect(handled).toEqual([]);
    expect(t.holders()).toBe(holders);
    expect(t.fake.editor.save).not.toHaveBeenCalled();
    expect(t.fake.editor.generate).not.toHaveBeenCalled();
  });

  test('a change cancelled while its canvas tab is being ensured rejects as cancelled, and holds and runs nothing', async () => {
    const { tools, registerTool } = registered();
    const t = setUp();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, sources);
    const ensuring = t.panels.ensure.getMockImplementation();
    if (ensuring === undefined) throw new Error('the fake panels ensure nothing');
    let proceed = () => {};
    t.panels.ensure.mockImplementationOnce(async (root, options) => {
      await new Promise<void>((resolve) => (proceed = resolve));
      return ensuring(root, options);
    });
    const cancellation = fakeCancellation();
    handled.splice(0);

    const call = Promise.resolve(
      tools
        .get('lace_change_module_canvas')
        ?.invoke(
          { input: { root: 'infra/prod', ...DELETE_DB }, toolInvocationToken: undefined },
          cancellation.token,
        ),
    );
    call.catch(() => {});
    await vi.waitFor(() => expect(t.panels.ensure).toHaveBeenCalled());
    cancellation.cancel();
    proceed();

    await expect(call).rejects.toBeInstanceOf(Cancelled);
    expect(handled).toEqual([]);
    // Only the canvas tab holds the session: the call took no hold.
    expect(t.acquired).toHaveLength(1);
    expect(t.holders()).toBe(1);
    expect(t.fake.editor.apply).not.toHaveBeenCalled();
  });

  test('no tool asks for a confirmation; each says what it runs on', async () => {
    const { tools, registerTool } = registered();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), setUp().ports, sources);
    for (const [name, tool] of tools) {
      const prepared = await tool.prepareInvocation?.({ input: { root: 'infra/prod' } }, token);
      expect(prepared, name).not.toHaveProperty('confirmationMessages');
      expect(prepared?.invocationMessage, name).toMatch(/: infra\/prod$/);
    }
  });

  test('a call names its root, which the tool does not receive', async () => {
    const { tools, registerTool } = registered();
    const { ports, commands } = setUp();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), ports, sources);
    handled.splice(0);
    const result = (await tools
      .get('lace_search_module_registry')
      ?.invoke(
        { input: { root: 'infra/prod', query: 'vpc' }, toolInvocationToken: undefined },
        token,
      )) as unknown as Result;
    expect(result.content).toEqual([new TextPart('{"modules":[],"truncated":false}')]);
    expect(commands.anywhere).toHaveBeenCalledOnce();
    expect(handled.map(({ tool, input }) => [tool, input])).toEqual([
      ['lace_search_module_registry', { query: 'vpc' }],
    ]);
  });

  test('an unknown root is an error that lists the roots', async () => {
    const { tools, registerTool } = registered();
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), setUp().ports, sources);
    const call = tools
      .get('lace_describe_module_canvas')
      ?.invoke({ input: { root: 'nowhere' }, toolInvocationToken: undefined }, token);
    await expect(call).rejects.toThrow(
      'The directories that hold Terraform or have an open canvas (1): infra/prod.',
    );
  });

  test('a stat that fails for another reason than a missing directory fails the call with its own error', async () => {
    const { tools, registerTool } = registered();
    const denied = {
      stat: async () => Promise.reject(new FileSystemError('NoPermissions')),
    };
    registerLaceTools(
      language({ registerTool } as LanguageModelApi['lm'], denied),
      setUp().ports,
      sources,
    );
    const call = tools
      .get('lace_describe_module_canvas')
      ?.invoke({ input: { root: 'infra/prod' }, toolInvocationToken: undefined }, token);
    await expect(call).rejects.toThrow('NoPermissions');
  });

  test('in a workspace with no Terraform, root `.` names the workspace folder: the change tool ensures its canvas without focus and applies the change', async () => {
    const { tools, registerTool } = registered();
    const t = setUp();
    const empty = { folders: () => [repo], openCanvases: () => [], terraformFiles: async () => [] };
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, empty);
    const result = (await tools
      .get('lace_change_module_canvas')
      ?.invoke({ input: { root: '.', ...DELETE_DB }, toolInvocationToken: undefined }, token)) as
      | Result
      | undefined;
    expect(t.panels.ensure).toHaveBeenCalledWith(
      { folder: repo, relative: '' },
      { preserveFocus: true },
    );
    expect(
      result?.content.map((part) => (part instanceof TextPart ? part.value : '')).join(''),
    ).toContain('Change 1: applied. deleted db.');
  });

  test('a result chat-core marks as an error is thrown with its text', async () => {
    const { tools, registerTool } = registered();
    const { ports } = setUp();
    const failing = fakeCommands({
      'registry describe': { fails: new Error('the registry is unreachable') },
    });
    ports.commands.anywhere = async () => failing.port;
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), ports, sources);
    const call = tools
      .get('lace_describe_registry_module')
      ?.invoke(
        { input: { root: 'infra/prod', module: 'acme/vpc' }, toolInvocationToken: undefined },
        token,
      );
    await expect(call).rejects.toThrow(
      'lace registry describe did not finish cleanly (the registry is unreachable)',
    );
  });
});
