// The chat tools on the real engine, as VS Code's chat calls them: each
// tool `registerLaceTools` registers, invoked with the `root` of a module
// directory, over the window's root sessions, commands mapping and canvas
// panels, for a developer signed out (a home of the test's own). The canvas
// panels are the extension's own over a stand-in for VS Code's webview
// panel, so a panel holds its root's session as a canvas tab does.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BoundPath, CommandsPort } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { createCanvasPanels } from '../../canvas/canvas-panels';
import { canvasOperations } from '../../commands/canvas-operations';
import {
  afterTest,
  moduleDirectory,
  realEngine,
  signedOutHome,
  until,
} from '../../engine/__tests__/real-engine';
import type { CommandsMapping } from '../../engine/commands-mapping';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import { createRootState } from '../../state/root-state';
import { type LanguageModelApi, registerLaceTools, TOOL_SCHEMAS } from '../lm-tools';
import { fakeCancellation } from './fake-session';

// The module `infra`: a root module calling two local modules.
//   net  outputs id
//   app  inputs name ("web"), subnet; output url
const MODULE = {
  'main.tf':
    'module "net" {\n  source = "./modules/net"\n}\n\nmodule "app" {\n  source = "./modules/app"\n  name   = "web"\n}\n',
  'modules/net/main.tf': 'output "id" {\n  value = "net-1"\n}\n',
  'modules/app/main.tf':
    'variable "name" {\n  type = string\n}\n\nvariable "subnet" {\n  type    = string\n  default = ""\n}\n\noutput "url" {\n  value = var.name\n}\n',
};

const ROOT = 'infra';

// What a Generate of `infra` reports: the root module's Terraform, and each
// module it calls written at the directory its id names.
const GENERATED =
  'Generated the Terraform. Files written: main.tf, modules/app/main.tf, modules/app/outputs.tf, modules/app/variables.tf, modules/net/main.tf, modules/net/outputs.tf.';

// The Terraform files under `directory`, as the workspace's file search
// finds them.
const terraformFiles = (directory: string): vscode.Uri[] =>
  readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tf'))
    .map((file) => uri(join(directory, file)));

// A stand-in for VS Code's webview panel: what the canvas panels call.
function webviewPanel() {
  let disposed = () => {};
  return {
    title: '',
    active: false,
    visible: true,
    reveal: vi.fn(),
    dispose: () => disposed(),
    onDidDispose: (listener: () => void) => {
      disposed = listener;
      return { dispose: () => {} };
    },
    onDidChangeViewState: () => ({ dispose: () => {} }),
    webview: {
      html: '',
      cspSource: 'vscode-webview://csp',
      asWebviewUri: (at: vscode.Uri) => at,
      postMessage: async () => true,
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    },
  };
}

// The window's workspaceState.
function memento(): vscode.Memento {
  const kept = new Map<string, unknown>();
  return {
    keys: () => [...kept.keys()],
    get: ((key: string, fallback?: unknown) => (kept.has(key) ? kept.get(key) : fallback)) as never,
    update: async (key: string, value: unknown) => {
      kept.set(key, value);
    },
  };
}

type Invoked = { cwd: string; path: BoundPath; args: Record<string, unknown> };

// The commands mapping, recording every invocation with the directory it
// runs in: the one the call names, else its port's.
function recording(commands: CommandsMapping, home: string) {
  const invoked: Invoked[] = [];
  const recorded = (cwd: string, port: CommandsPort): CommandsPort => ({
    available: () => port.available(),
    invoke(path, args, signal, directory) {
      invoked.push({ cwd: directory ?? cwd, path, args: args as Record<string, unknown> });
      return port.invoke(path, args, signal, directory);
    },
  });
  const mapping: CommandsMapping = {
    at: async (root) => recorded(root, await commands.at(root)),
    anywhere: async () => recorded(home, await commands.anywhere()),
  };
  return { invoked, mapping };
}

class ToolResult {
  constructor(readonly content: { value: string }[]) {}
}
class TextPart {
  constructor(readonly value: string) {}
}
class Cancelled extends Error {}

// The window's tools over the real engine, registered as VS Code registers
// them.
function toolsWindow() {
  const home = signedOutHome();
  const { repository, root } = moduleDirectory({});
  for (const [file, content] of Object.entries(MODULE)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const reports: { what: string; error: unknown }[] = [];
  const report = (what: string, error: unknown) => reports.push({ what, error });
  const { engine, rootSessions, commands } = realEngine({ home });
  const lace = recording(commands, home);

  const opened: { title: string; preserveFocus: boolean }[] = [];
  const panels = createCanvasPanels({
    api: {
      window: {
        createWebviewPanel: (_type: string, title: string, show: { preserveFocus: boolean }) => {
          opened.push({ title, preserveFocus: show.preserveFocus });
          return webviewPanel();
        },
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showTextDocument: async () => ({}) as vscode.TextEditor,
      } as never,
      workspace: {
        fs: { readDirectory: async () => [] },
        openTextDocument: async () => ({}),
      } as never,
      ViewColumn: { Active: -1, Beside: -2 },
      Range: class {} as never,
    },
    extensionUri: uri('/extension'),
    engine,
    rootSessions,
    rootState: createRootState(memento()),
    confirm: async () => false,
    pageFocus: () => {},
    offers: {} as never,
    validate: async () => {},
    generated: async () => {},
    report,
  });
  afterTest(() => panels.dispose());

  const ports = {
    panels,
    rootSessions,
    operations: canvasOperations({
      workspace: { workspaceFolders: [folder(repository)], textDocuments: [] },
      rootSessions,
    }),
    commands: lace.mapping,
  };
  const registered = new Map<string, vscode.LanguageModelTool<Record<string, unknown>>>();
  const language: LanguageModelApi = {
    lm: {
      registerTool: (name: string, tool: vscode.LanguageModelTool<Record<string, unknown>>) => {
        registered.set(name, tool);
        return { dispose: () => registered.delete(name) };
      },
    } as LanguageModelApi['lm'],
    LanguageModelToolResult: ToolResult as unknown as typeof vscode.LanguageModelToolResult,
    LanguageModelTextPart: TextPart as unknown as typeof vscode.LanguageModelTextPart,
    CancellationError: Cancelled as unknown as typeof vscode.CancellationError,
  };
  const registration = registerLaceTools(language, ports, {
    folders: () => [folder(repository)],
    terraformFiles: async () => terraformFiles(repository),
  });
  afterTest(() => registration.dispose());

  // What VS Code's chat does with a tool call: the registered tool invoked
  // with its input. Resolves with the result's text; a failed call rejects.
  async function invoke(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = registered.get(name);
    if (!tool) throw new Error(`no tool ${name} is registered`);
    const result = (await tool.invoke(
      { input, toolInvocationToken: undefined },
      fakeCancellation().token,
    )) as unknown as ToolResult;
    return result.content.map((part) => part.value).join('');
  }

  // The latest frame of the root's session while something holds it.
  function frame() {
    const [held] = rootSessions.held();
    if (!held) throw new Error(`no session of ${root} is held`);
    let latest: Parameters<Parameters<typeof held.ports.source.subscribe>[0]>[0] | undefined;
    held.ports.source.subscribe(
      (next) => {
        latest = next;
      },
      () => {},
    )();
    if (!latest) throw new Error('the session delivered no frame');
    return latest;
  }

  return {
    home,
    root,
    engine,
    rootSessions,
    panels,
    opened,
    invoked: lace.invoked,
    reports,
    registered,
    invoke,
    frame,
  };
}

const CHANGE = 'lace_change_module_canvas';
const DESCRIBE = 'lace_describe_module_canvas';
const SAVE = 'lace_save_module_canvas';
const GENERATE = 'lace_generate_module_terraform';
const VALIDATE = 'lace_validate_module_terraform';
const SEARCH_REGISTRY = 'lace_search_module_registry';
const DESCRIBE_REGISTRY_MODULE = 'lace_describe_registry_module';

const RENAME_NET = { changes: [{ operation: 'rename', instance: 'net', value: 'network' }] };

// The names of the instances the root module calls, sorted.
const instanceNames = (frame: { bundle: { entry: string; modules: Record<string, unknown> } }) =>
  (frame.bundle.modules[frame.bundle.entry] as { modules: { id: string }[] }).modules
    .map((call) => call.id)
    .sort();

describe('the chat tools on the real engine', () => {
  test('every tool registerLaceTools registers answers a call naming its root', async () => {
    const window = toolsWindow();
    expect([...window.registered.keys()]).toEqual(TOOL_SCHEMAS.map((schema) => schema.name));

    expect(await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET })).toContain(
      'Change 1: applied. renamed net to network.',
    );
    expect(await window.invoke(DESCRIBE, { root: ROOT })).toContain(
      '- network: module modules/net@0.0.1',
    );
    expect(await window.invoke(SAVE, { root: ROOT })).toContain('Saved the canvas.');
    expect(await window.invoke(GENERATE, { root: ROOT })).toContain(GENERATED);
    expect(await window.invoke(VALIDATE, { root: ROOT })).toContain(
      '"verdict":"already-lace-style"',
    );
    await expect(window.invoke(SEARCH_REGISTRY, { root: ROOT, query: 'vpc' })).rejects.toThrow(
      /^lace registry list failed \(reason unauthenticated\): no credentials found/,
    );
    await expect(
      window.invoke(DESCRIBE_REGISTRY_MODULE, { root: ROOT, module: 'acme/vpc' }),
    ).rejects.toThrow(
      /^lace registry describe failed \(reason unauthenticated\): no credentials found/,
    );
  });

  test('a root that names no module directory is an error listing the ones that hold Terraform', async () => {
    const window = toolsWindow();
    await expect(window.invoke(DESCRIBE, { root: 'nowhere' })).rejects.toThrow(
      'No module directory of this workspace is named "nowhere". The directories holding Terraform (3): infra, infra/modules/app, infra/modules/net.',
    );
    expect(window.rootSessions.held()).toEqual([]);
  });
});

describe('the change tool on the real engine', () => {
  test("applies a change on the root's session after its canvas tab is ensured without focus, and the tab holds the session afterwards", async () => {
    const window = toolsWindow();

    await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET });
    expect(window.opened).toEqual([{ title: ROOT, preserveFocus: true }]);
    expect(window.rootSessions.held()).toMatchObject([{ root: window.root, holders: 1 }]);
    expect(instanceNames(window.frame())).toEqual(['app', 'network']);
    expect(window.frame().unsaved).toBe(true);

    // A second change sees the first, on the same tab.
    const set = await window.invoke(CHANGE, {
      root: ROOT,
      changes: [{ operation: 'set', instance: 'app', input: 'name', value: 'api' }],
    });
    expect(set).toContain('Change 1: applied. set app.name = "api".');
    expect(set).toContain('- network: module modules/net@0.0.1');
    expect(window.opened).toHaveLength(1);
    expect(window.rootSessions.held()).toMatchObject([{ holders: 1 }]);
  });

  test('a delete reaches the engine and nothing else: the extension makes no request of its own and logs nothing', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    afterTest(() => fetched.mockRestore());
    const window = toolsWindow();

    const result = await window.invoke(CHANGE, {
      root: ROOT,
      changes: [{ operation: 'delete', instance: 'net' }],
    });
    expect(result).toContain('Change 1: applied. deleted net.');
    expect(instanceNames(window.frame())).toEqual(['app']);
    await window.invoke(SAVE, { root: ROOT });
    await until('the saved frame', () => !window.frame().unsaved);

    expect(fetched).not.toHaveBeenCalled();
    expect(window.reports).toEqual([]);
  });

  test("a call after the engine restarts runs on the session the root's tab is on again", async () => {
    const window = toolsWindow();
    await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET });
    const [before] = window.rootSessions.held();

    await window.engine.restart();
    await until(
      'the tab on a session of the restarted engine',
      () => window.rootSessions.held()[0]?.sessionId !== before?.sessionId,
    );

    const described = await window.invoke(DESCRIBE, { root: ROOT });
    expect(described).toContain('- net: module modules/net@0.0.1');
    expect(window.rootSessions.held()).toMatchObject([{ holders: 1 }]);
  });
});

describe("describe, save and generate on the root's session", () => {
  test('describe with no canvas open reads the root on a hold for the call, opens no tab and leaves no session', async () => {
    const window = toolsWindow();

    const described = await window.invoke(DESCRIBE, { root: ROOT });
    expect(described).toContain('Canvas of module ./infra');
    expect(described).toContain('- net: module modules/net@0.0.1');
    expect(described).toContain('Standing: unsaved edits: no;');
    expect(window.opened).toEqual([]);
    expect(window.rootSessions.held()).toEqual([]);
  });

  test('describe joins the session the canvas tab holds and shows its unsaved edit', async () => {
    const window = toolsWindow();
    await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET });

    const described = await window.invoke(DESCRIBE, { root: ROOT });
    expect(described).toContain('- network: module modules/net@0.0.1');
    expect(described).toContain('Standing: unsaved edits: yes;');
    expect(window.opened).toHaveLength(1);
    expect(window.rootSessions.held()).toMatchObject([{ holders: 1 }]);
  });

  test('save on a root with no open canvas says it holds nothing unsaved and opens nothing', async () => {
    const window = toolsWindow();

    expect(await window.invoke(SAVE, { root: ROOT })).toBe(
      'infra has no open canvas, so it holds no unsaved edits: nothing was saved.',
    );
    expect(window.opened).toEqual([]);
    expect(window.rootSessions.held()).toEqual([]);
    expect(existsSync(join(window.root, '.lace', '.canvas'))).toBe(false);
  });

  test('save saves the session the canvas tab holds', async () => {
    const window = toolsWindow();
    await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET });

    expect(await window.invoke(SAVE, { root: ROOT })).toContain('Saved the canvas.');
    await until('the saved frame', () => !window.frame().unsaved);
    expect(window.frame().ungenerated).toBe(true);
    expect(existsSync(join(window.root, '.lace', '.canvas', 'state.lace'))).toBe(true);
  });

  test("the canvas a save's result carries is the saved one", async () => {
    const window = toolsWindow();
    await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET });

    const saved = await window.invoke(SAVE, { root: ROOT });
    expect(saved).toContain('Saved the canvas.');
    expect(saved).toContain('- network: module modules/net@0.0.1');
    expect(saved).toContain(
      'Standing: unsaved edits: no; saved edits not generated to Terraform: yes;',
    );
    expect(window.frame().unsaved).toBe(false);
  });

  test('generate writes the saved canvas to the Terraform on a hold for the call, with no canvas tab', async () => {
    const window = toolsWindow();
    await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET });
    await window.invoke(SAVE, { root: ROOT });
    await until('the saved frame', () => !window.frame().unsaved);
    window.panels.dispose();
    await until('the tab releasing the session', () => window.rootSessions.held().length === 0);

    const generated = await window.invoke(GENERATE, { root: ROOT });
    expect(generated).toContain(GENERATED);
    expect(generated).toContain(
      'lace module validate on the Terraform on disk: {"verdict":"already-lace-style"',
    );
    expect(readFileSync(join(window.root, 'main.tf'), 'utf8')).toContain('module "network" {');
    expect(window.opened).toHaveLength(1);
    expect(window.rootSessions.held()).toEqual([]);
  });

  test('generate with unsaved canvas edits is a failed call naming the reason', async () => {
    const window = toolsWindow();
    await window.invoke(CHANGE, { root: ROOT, ...RENAME_NET });

    await expect(window.invoke(GENERATE, { root: ROOT })).rejects.toThrow(
      /^Lace did not generate: .* \(reason unsaved\)\./,
    );
    expect(readFileSync(join(window.root, 'main.tf'), 'utf8')).toBe(MODULE['main.tf']);
  });
});

describe('validate in the root', () => {
  test("runs lace module validate in the root's directory on no session, and returns its verdict", async () => {
    const window = toolsWindow();

    const validated = await window.invoke(VALIDATE, { root: ROOT });
    expect(JSON.parse(validated)).toMatchObject({
      verdict: 'already-lace-style',
      terraform: { valid: true },
    });
    expect(window.invoked.map(({ cwd, path }) => [cwd, path])).toEqual([
      [window.root, 'module validate'],
    ]);
    expect(window.rootSessions.held()).toEqual([]);
    expect(existsSync(join(window.root, '.lace', '.canvas'))).toBe(false);
  });
});

describe('the registry tools in the home, signed out', () => {
  test("run in the developer's home on no session, and fail as the tool's error with the CLI's failure", async () => {
    const window = toolsWindow();

    await expect(window.invoke(SEARCH_REGISTRY, { root: ROOT, query: 'vpc' })).rejects.toThrow(
      "no credentials found; run 'lace login' or set LACE_TOKEN",
    );
    await expect(
      window.invoke(DESCRIBE_REGISTRY_MODULE, { root: ROOT, module: 'acme/vpc' }),
    ).rejects.toThrow("no credentials found; run 'lace login' or set LACE_TOKEN");
    expect(window.invoked.map(({ cwd, path }) => [cwd, path])).toEqual([
      [window.home, 'registry list'],
      [window.home, 'registry describe'],
    ]);
    expect(window.rootSessions.held()).toEqual([]);
    expect(window.opened).toEqual([]);
  });

  test('a signed-out call names the reason unauthenticated', async () => {
    const window = toolsWindow();

    await expect(window.invoke(SEARCH_REGISTRY, { root: ROOT, query: 'vpc' })).rejects.toThrow(
      "lace registry list failed (reason unauthenticated): no credentials found; run 'lace login' or set LACE_TOKEN",
    );
    await expect(
      window.invoke(DESCRIBE_REGISTRY_MODULE, { root: ROOT, module: 'acme/vpc' }),
    ).rejects.toThrow(
      "lace registry describe failed (reason unauthenticated): no credentials found; run 'lace login' or set LACE_TOKEN",
    );
  });
});
