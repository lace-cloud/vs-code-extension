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
import { folder, uri } from '../../roots/__tests__/fake-uri';
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

const DELETE_DB = { changes: [{ operation: 'delete', instance: 'db' }] };
const RENAME_APP = { changes: [{ operation: 'rename', instance: 'app', value: 'frontend' }] };

// The canvas a call's result ends with lists each instance as `- <name>:`.
const instancesIn = (content: string): string[] =>
  [...content.matchAll(/^- (\w+): module/gm)].map(([, name]) => name);

// `scripts`: commands scripted beyond the validate and registry listing
// every call can make; `fake`: the root's session.
function setUp(scripts: Scripts = {}, fake = fakeSession()) {
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
      workspace: { workspaceFolders: [repo], textDocuments } as never,
      rootSessions,
    }),
    commands,
  };
  const laceTools = createLaceTools(ports);
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
    expect(acquired).toEqual(['/work/repo/infra/prod']);
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
    expect(result.content).toContain('Files written: main.tf');
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
      ['/work/repo/infra/prod', 'module validate'],
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

  test('is its path in the workspace, `.` for the folder itself', async () => {
    const sources = {
      folders: () => [app],
      terraformFiles: async () => files('/work/app/main.tf', '/work/app/infra/prod/main.tf'),
    };
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

  test('names the folder first in a workspace of several folders', async () => {
    const sources = {
      folders: () => [app, api],
      terraformFiles: async () => files('/work/app/infra/main.tf', '/work/api/infra/main.tf'),
    };
    expect(await rootNamed(sources, 'api/infra')).toEqual({ folder: api, relative: 'infra' });
    expect(await rootNamed(sources, 'app/infra')).toEqual({ folder: app, relative: 'infra' });
  });

  test('that names no directory holding Terraform is an error listing the ones that do', async () => {
    const sources = {
      folders: () => [app],
      terraformFiles: async () =>
        files('/work/app/infra/prod/main.tf', '/work/app/.terraform/modules/x/main.tf'),
    };
    const refused = rootNamed(sources, 'infra/staging');
    await expect(refused).rejects.toBeInstanceOf(UnknownRoot);
    await expect(refused).rejects.toMatchObject({ roots: ['infra/prod'] });
    await expect(refused).rejects.toThrow(
      'No module directory of this workspace is named "infra/staging". The directories holding Terraform (1): infra/prod.',
    );
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
    terraformFiles: async () => [uri('/work/repo/infra/prod/main.tf')],
  };

  function language(lm: LanguageModelApi['lm']): LanguageModelApi {
    return {
      lm,
      LanguageModelToolResult: Result as unknown as typeof vscode.LanguageModelToolResult,
      LanguageModelTextPart: TextPart as unknown as typeof vscode.LanguageModelTextPart,
      CancellationError: Cancelled as unknown as typeof vscode.CancellationError,
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
    // The workspace's Terraform files are still being found.
    let found = () => {};
    const finding = {
      folders: () => [repo],
      terraformFiles: () =>
        new Promise<vscode.Uri[]>((resolve) => {
          found = () => resolve([uri('/work/repo/infra/prod/main.tf')]);
        }),
    };
    registerLaceTools(language({ registerTool } as LanguageModelApi['lm']), t.ports, finding);
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
    await expect(call).rejects.toThrow('The directories holding Terraform (1): infra/prod.');
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
