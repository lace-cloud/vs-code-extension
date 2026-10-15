import {
  CommandExitError,
  type CommandFailure,
  type GenerateEvent,
  Reason,
} from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
  fakeCommands,
  refused,
  type Script,
  type Scripts,
} from '../../engine/__tests__/fake-commands';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot, RootSources } from '../../roots/authoring-roots';
import { VALIDATED } from '../../tools/__tests__/fake-session';
import { type Button, clicked, shownBy } from '../../vscode/__tests__/fake-messages';
import type { OfferActions } from '../../vscode/offers';
import {
  type AuthoringApi,
  authoringCommands,
  CONVERT_MODULE,
  FORMAT_MODULE,
  GENERATE_CANVAS,
  GENERATE_DOCS,
  SAVE_CANVAS,
  SCAN_MODULE,
  VALIDATE_MODULE,
} from '../authoring-commands';
import { canvasOperations } from '../canvas-operations';
import { saveTerraformBuffers } from '../terraform-buffers';

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };
const PROD = '/work/repo/infra/prod';

function document(path: string, dirty: boolean, saves = true) {
  return { uri: uri(path), isDirty: dirty, save: vi.fn(async () => saves) };
}

function fakeApi(answer?: string) {
  const textDocuments: ReturnType<typeof document>[] = [];
  const api = {
    window: {
      showInformationMessage: vi.fn(async (_text: string, ...buttons: Button[]) =>
        clicked(buttons, answer),
      ),
      showWarningMessage: vi.fn(async (_text: string, ...buttons: Button[]) =>
        clicked(buttons, answer),
      ),
      showErrorMessage: vi.fn(async (_text: string, ...buttons: Button[]) =>
        clicked(buttons, answer),
      ),
      showTextDocument: vi.fn(async () => ({})),
      withProgress: vi.fn((_options, task) => task({ report: vi.fn() }, {})),
      setStatusBarMessage: vi.fn(),
    },
    workspace: {
      workspaceFolders: [repo],
      textDocuments,
      openTextDocument: vi.fn(async (options: unknown) => ({ opened: options })),
    },
    commands: { executeCommand: vi.fn(async () => undefined) },
    ProgressLocation: { Notification: 15 },
  };
  return { api, textDocuments };
}

// The root's session: open in this window or not, under the spelling its
// first holder gave, with the editor its holds reach. Each hold is counted
// until it is released.
function rootSessions(open: boolean, editor: object, spelled = PROD) {
  let holders = 0;
  return {
    held: () => (open ? [{ root: spelled, sessionId: 's', ports: {}, holders: 1 }] : []),
    acquire: vi.fn(async (root: string) => {
      holders += 1;
      return {
        root,
        sessionId: 's',
        ports: { editor },
        renewed: () => () => {},
        release: async () => {
          holders -= 1;
        },
      };
    }),
    holders: () => holders,
  };
}

// The roots a command can name: the active canvas's, else those
// `terraformFiles` holds and the canvases open, whose pick the developer
// dismisses.
const sources = (
  root: AuthoringRoot | undefined,
  terraformFiles: readonly vscode.Uri[] = [],
  canvases: readonly AuthoringRoot[] = root ? [root] : [],
  folders: readonly vscode.WorkspaceFolder[] = [repo],
): RootSources => ({
  folders: () => folders,
  activeCanvas: () => root,
  openCanvases: () => canvases,
  activeTerraformDirectory: () => undefined,
  terraformFiles: async () => terraformFiles,
  pick: async () => undefined,
});

function setup(
  scripts: Scripts,
  options: {
    answer?: string;
    root?: AuthoringRoot;
    terraformFiles?: readonly vscode.Uri[];
    // The canvases open in the window, focused or not.
    canvases?: readonly AuthoringRoot[];
    // The workspace's folders; one by default.
    folders?: readonly vscode.WorkspaceFolder[];
    // Whether this window holds the root's session, and the spelling of the
    // root it was opened with.
    open?: boolean;
    spelled?: string;
    editor?: object;
  } = {},
) {
  const { api, textDocuments } = fakeApi(options.answer);
  const lace = fakeCommands(scripts);
  const log = { appendLine: vi.fn(), show: vi.fn() };
  const sessions = rootSessions(options.open ?? false, options.editor ?? {}, options.spelled);
  const offers: OfferActions = {
    signIn: vi.fn(),
    selectOrganization: vi.fn(),
    selectTeam: vi.fn(),
    openPortal: vi.fn(),
    install: vi.fn(),
    openRecord: vi.fn(),
  };
  const { table } = authoringCommands({
    api: api as unknown as AuthoringApi,
    sources: sources(
      'root' in options ? options.root : prod,
      options.terraformFiles,
      options.canvases,
      options.folders,
    ),
    operations: canvasOperations({
      workspace: api.workspace as never,
      rootSessions: sessions as never,
    }),
    commands: lace.commands,
    log,
    offers,
  });
  return { api, textDocuments, invoked: lace.invoked, log, table, sessions, offers };
}

// `module validate`'s report of a loss, as the CLI prints one: it stops at
// its verdict, so what its run never reached (the deviation, Terraform's
// validate, the resolved children) is absent.
const lossReport = (diagnostics: object[]) => ({
  root: PROD,
  treeHash: 'h',
  verdict: 'lossy',
  residuals: [],
  exitClass: 'parse',
  diagnostics,
});

const validated = (diagnostics: object[]): Script => ({
  documents: [lossReport(diagnostics)],
});

// `module validate`'s report of a tree Lace's rules refuse, as the CLI
// prints one: its run stopped short of a verdict, so it has none, and its
// diagnostics are its outcome. The command exits 1.
const refusedTree = (diagnostics: object[]) => ({
  root: PROD,
  treeHash: 'h',
  residuals: [],
  terraform: { valid: true, diagnostics: [] },
  exitClass: 'validate',
  diagnostics,
});
const VALIDATION_FAILED = new CommandExitError(1, 'Module validation failed\n');

// What `module convert` wrote and removed, and the validate it ended with.
const conversion = (
  written: string[],
  removed: string[] = [],
  diagnostics: object[] = [],
): { documents: object[] } => ({
  documents: [
    {
      changed: written.length > 0,
      written,
      removed,
      validate: { ...VALIDATED, root: PROD, treeHash: 'h', diagnostics },
      diagnostics,
    },
  ],
});

const FINDING = { severity: 'error', message: 'not set', file: 'main.tf', line: 4, column: 2 };

describe('the module commands', () => {
  test.each([
    [VALIDATE_MODULE, 'module validate', validated([])],
    [CONVERT_MODULE, 'module convert', conversion([])],
    [SCAN_MODULE, 'module scan', { documents: [{ treeHash: 'h', diagnostics: [] }] }],
    [FORMAT_MODULE, 'module fmt', { documents: [{ changed: [] }] }],
    [GENERATE_DOCS, 'module docs', { documents: [{ markdown: '# m' }] }],
  ] as const)('%s runs %s in the authoring root, through the commands mapping', async (id, path, script) => {
    const { table, invoked } = setup({ [path]: script });
    await table[id]();
    expect(invoked).toEqual([{ cwd: PROD, path, args: {} }]);
  });

  test.each([
    [FORMAT_MODULE, 'module fmt', { documents: [{ changed: [] }] }],
    [CONVERT_MODULE, 'module convert', conversion([])],
  ] as const)('%s writes the Terraform, so it saves the root’s dirty Terraform buffers first, and only those', async (id, path, script) => {
    const { table, textDocuments, invoked } = setup({ [path]: script });
    const mine = document(`${PROD}/main.tf`, true);
    const nested = document(`${PROD}/modules/a/main.tf`, true);
    const json = document(`${PROD}/outputs.tf.json`, true);
    const clean = document(`${PROD}/variables.tf`, false);
    const other = document('/work/repo/infra/stage/main.tf', true);
    const notes = document(`${PROD}/README.md`, true);
    textDocuments.push(mine, nested, json, clean, other, notes);
    mine.save.mockImplementation(async () => {
      expect(invoked).toEqual([]);
      return true;
    });

    await table[id]();
    expect(mine.save).toHaveBeenCalled();
    expect(nested.save).toHaveBeenCalled();
    expect(json.save).toHaveBeenCalled();
    for (const unsaved of [clean, other, notes]) expect(unsaved.save).not.toHaveBeenCalled();
    expect(invoked).toEqual([{ cwd: PROD, path, args: {} }]);
  });

  // One rule per operation, whatever triggers it: a command that writes the
  // root's Terraform saves a dirty buffer first; one that reads it reads the
  // files on disk, as in a terminal, the chat's validate tool and the
  // canvas's Validate, and writes nothing into the tree.
  test.each([
    [VALIDATE_MODULE, false, 'module validate', validated([])],
    [SCAN_MODULE, false, 'module scan', { documents: [{ treeHash: 'h', diagnostics: [] }] }],
    [GENERATE_DOCS, false, 'module docs', { documents: [{ markdown: '# m' }] }],
    [FORMAT_MODULE, true, 'module fmt', { documents: [{ changed: [] }] }],
    [CONVERT_MODULE, true, 'module convert', conversion([])],
  ] as const)('with a dirty buffer, %s saves it first: %s', async (id, saves, path, script) => {
    const { table, textDocuments, invoked } = setup({ [path]: script });
    const dirty = document(`${PROD}/main.tf`, true);
    textDocuments.push(dirty);

    await table[id]();
    expect(dirty.save.mock.calls.length > 0).toBe(saves);
    expect(invoked).toEqual([{ cwd: PROD, path, args: {} }]);
  });

  test('with a dirty buffer, Generate saves it first', async () => {
    const editor = {
      generate: vi.fn(() =>
        (async function* (): AsyncGenerator<GenerateEvent> {
          yield { type: 'error', message: 'unsaved', reason: Reason.REASON_UNSAVED };
        })(),
      ),
    };
    const { table, textDocuments } = setup({}, { editor });
    const dirty = document(`${PROD}/main.tf`, true);
    dirty.save.mockImplementation(async () => {
      expect(editor.generate).not.toHaveBeenCalled();
      return true;
    });
    textDocuments.push(dirty);

    await table[GENERATE_CANVAS]();
    expect(dirty.save).toHaveBeenCalled();
    expect(editor.generate).toHaveBeenCalledOnce();
  });

  test('run nothing when a buffer does not save', async () => {
    const { table, textDocuments, invoked, api } = setup({ 'module fmt': { documents: [] } });
    textDocuments.push(document(`${PROD}/main.tf`, true, false));
    await table[FORMAT_MODULE]();
    expect(invoked).toEqual([]);
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('infra/prod'));
  });

  test('run nothing when no root is named, and say why', async () => {
    const { table, invoked, api } = setup({}, { root: undefined });
    await table[SCAN_MODULE]();
    expect(invoked).toEqual([]);
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'No module to scan: no directory under this workspace holds Terraform files and no canvas is open. Start one with Lace: Open Canvas.',
    );
  });

  test('Validate in a workspace with no Terraform and no canvas open runs nothing and says so: an empty tree has nothing to certify', async () => {
    const { table, invoked, api } = setup({}, { root: undefined });
    await table[VALIDATE_MODULE]();
    expect(invoked).toEqual([]);
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'No module to validate: no directory under this workspace holds Terraform files and no canvas is open. Start one with Lace: Open Canvas.',
    );
  });

  test('run nothing and say nothing when the developer dismisses the pick of a module', async () => {
    const { table, invoked, api } = setup(
      {},
      {
        root: undefined,
        terraformFiles: [uri(`${PROD}/main.tf`), uri('/work/repo/infra/stage/main.tf')],
      },
    );
    await table[VALIDATE_MODULE]();
    expect(invoked).toEqual([]);
    expect(api.window.showInformationMessage).not.toHaveBeenCalled();
  });

  test('run nothing on a folder inside Terraform’s cache, and say what it is', async () => {
    const { table, invoked, api } = setup({}, { root: undefined });
    await table[GENERATE_DOCS](uri(`${PROD}/.terraform/modules/net`));
    expect(invoked).toEqual([]);
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'No module to document: infra/prod/.terraform/modules/net is inside .terraform, which is not a module directory.',
    );
  });

  test('name the root in their progress', async () => {
    const { table, api } = setup({ 'module validate': validated([]) });
    await table[VALIDATE_MODULE]();
    expect(api.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Lace: validating infra/prod' }),
      expect.any(Function),
    );
  });

  test("in a workspace of several folders, name the root by its path in the workspace, the folder's name first", async () => {
    const api = folder('/work/api', 0);
    const web = folder('/work/web', 1);
    const t = setup(
      { 'module validate': validated([]) },
      { root: { folder: api, relative: 'infra/prod' }, folders: [api, web] },
    );
    await t.table[VALIDATE_MODULE]();
    expect(t.api.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Lace: validating api/infra/prod' }),
      expect.any(Function),
    );
    expect(t.api.window.showInformationMessage).toHaveBeenCalledWith(
      'Validated api/infra/prod: lossy, 0 diagnostics.',
      'Show Report',
    );
  });
});

describe('Validate and Scan', () => {
  test('with no session, the verdict is a notification and Show Report writes the report to the Output channel', async () => {
    const { table, api, log } = setup(
      { 'module validate': validated([FINDING]) },
      { answer: 'Show Report' },
    );
    await table[VALIDATE_MODULE]();

    expect(api.window.showWarningMessage).toHaveBeenCalledWith(
      'Validated infra/prod: lossy, 1 diagnostic.',
      'Show Report',
    );
    expect(log.appendLine.mock.calls.map(([line]) => line)).toEqual([
      'Validated infra/prod: lossy, 1 diagnostic.',
      `  ${PROD}/main.tf:4:2: error: not set`,
    ]);
    expect(log.show).toHaveBeenCalled();
    expect(api.window.setStatusBarMessage).not.toHaveBeenCalled();
  });

  test('with the root’s session held under another spelling of the root, the report is left to Problems', async () => {
    const { table, api } = setup(
      { 'module validate': validated([FINDING]) },
      { open: true, spelled: '/work/repo/infra/../infra/prod' },
    );
    await table[VALIDATE_MODULE]();
    expect(api.window.showWarningMessage).not.toHaveBeenCalled();
    expect(api.window.setStatusBarMessage).toHaveBeenCalledWith(
      'Lace: Validated infra/prod: lossy; the report is in Problems',
      5000,
    );
  });

  test('a validate that stopped short of a verdict reports its diagnostics, and names no verdict', async () => {
    const { table, api, log } = setup(
      { 'module validate': { documents: [refusedTree([FINDING])], fails: VALIDATION_FAILED } },
      { answer: 'Show Report' },
    );
    await table[VALIDATE_MODULE]();

    expect(api.window.showWarningMessage).toHaveBeenCalledWith(
      'Validated infra/prod, 1 diagnostic.',
      'Show Report',
    );
    expect(log.appendLine.mock.calls.map(([line]) => line)).toEqual([
      'Validated infra/prod, 1 diagnostic.',
      `  ${PROD}/main.tf:4:2: error: not set`,
    ]);
    expect(api.window.showErrorMessage).not.toHaveBeenCalled();
  });

  test('a validate that stopped short of a verdict, with the root’s session held, names no verdict in its status', async () => {
    const { table, api } = setup(
      { 'module validate': { documents: [refusedTree([FINDING])], fails: VALIDATION_FAILED } },
      { open: true },
    );
    await table[VALIDATE_MODULE]();
    expect(api.window.setStatusBarMessage).toHaveBeenCalledWith(
      'Lace: Validated infra/prod; the report is in Problems',
      5000,
    );
  });

  test('with the root’s session held, the report is left to Problems', async () => {
    const { table, api, log } = setup(
      { 'module scan': { documents: [{ treeHash: 'h', diagnostics: [FINDING] }] } },
      { open: true },
    );
    await table[SCAN_MODULE]();

    expect(api.window.showWarningMessage).not.toHaveBeenCalled();
    expect(api.window.showInformationMessage).not.toHaveBeenCalled();
    expect(log.appendLine).not.toHaveBeenCalled();
    expect(api.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('Problems'),
      expect.any(Number),
    );
  });

  test('a missing tool is named by its failure, and Install opens the URL the failure carries', async () => {
    const failure: CommandFailure = {
      reason: 'tool_missing',
      message: 'terraform-docs is not installed',
      tool: 'terraform-docs',
      url: 'https://terraform-docs.io',
    };
    const { table, api, offers } = setup(
      { 'module docs': refused(failure) },
      { answer: 'Install' },
    );
    await table[GENERATE_DOCS]();

    expect(shownBy(api.window.showErrorMessage)).toEqual([
      ['terraform-docs is not installed', 'Install'],
    ]);
    expect(offers.install).toHaveBeenCalledWith({
      kind: 'install',
      url: 'https://terraform-docs.io',
    });
  });

  test('a failure whose reason names a way out offers it', async () => {
    const failure: CommandFailure = { reason: 'unauthenticated', message: 'sign in first' };
    const { table, api, offers } = setup(
      { 'module validate': refused(failure) },
      { answer: 'Sign In' },
    );
    await table[VALIDATE_MODULE]();

    expect(shownBy(api.window.showErrorMessage)).toEqual([['sign in first', 'Sign In']]);
    expect(offers.signIn).toHaveBeenCalledOnce();
  });

  test('another failure shows its message and offers nothing', async () => {
    const failure: CommandFailure = { reason: 'unspecified', message: 'no such directory' };
    const { table, api, offers } = setup(
      { 'module validate': refused(failure) },
      { answer: 'Install' },
    );
    await table[VALIDATE_MODULE]();

    expect(api.window.showErrorMessage).toHaveBeenCalledWith('no such directory');
    expect(offers.install).not.toHaveBeenCalled();
  });
});

describe('Convert', () => {
  test('saves the root’s dirty Terraform buffers, then reports the files it wrote and removed and its verdict', async () => {
    const { table, api, textDocuments, invoked, log } = setup(
      { 'module convert': conversion(['web/main.tf', 'main.tf'], ['flat.tf']) },
      { answer: 'Show Report' },
    );
    const buffer = document(`${PROD}/flat.tf`, true);
    textDocuments.push(buffer);
    await table[CONVERT_MODULE]();

    expect(buffer.save).toHaveBeenCalled();
    expect(invoked).toEqual([{ cwd: PROD, path: 'module convert', args: {} }]);
    const text =
      'Converted infra/prod: wrote web/main.tf, main.tf; removed flat.tf; already-lace-style, 0 diagnostics.';
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(text, 'Show Report');
    expect(log.appendLine).toHaveBeenCalledWith(text);
  });

  test('a module in Lace style already is left as it is, and Convert says it wrote nothing', async () => {
    const { table, api } = setup({ 'module convert': conversion([]) });
    await table[CONVERT_MODULE]();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'infra/prod is in Lace style already, so Convert wrote nothing, 0 diagnostics.',
      'Show Report',
    );
  });

  test('the diagnostics of the validate it ended with are its report, even when that validate failed', async () => {
    const written = conversion(['main.tf'], [], [FINDING]);
    const { table, api } = setup(
      {
        'module convert': {
          ...written,
          fails: new CommandExitError(1, 'Error: terraform validate reported errors\n'),
        },
      },
      { answer: 'Show Report' },
    );
    await table[CONVERT_MODULE]();
    expect(api.window.showWarningMessage).toHaveBeenCalledWith(
      'Converted infra/prod: wrote main.tf; already-lace-style, 1 diagnostic.',
      'Show Report',
    );
  });

  test('a validate it ended with that stopped short of a verdict leaves the verdict out, and its diagnostics are the report', async () => {
    const { table, api } = setup(
      {
        'module convert': {
          documents: [
            {
              changed: true,
              written: ['main.tf'],
              removed: [],
              validate: refusedTree([FINDING]),
              diagnostics: [FINDING],
            },
          ],
          fails: VALIDATION_FAILED,
        },
      },
      { answer: 'Show Report' },
    );
    await table[CONVERT_MODULE]();
    expect(api.window.showWarningMessage).toHaveBeenCalledWith(
      'Converted infra/prod: wrote main.tf, 1 diagnostic.',
      'Show Report',
    );
  });

  test('with the root’s session held, the report is left to Problems', async () => {
    const { table, api } = setup({ 'module convert': conversion(['main.tf']) }, { open: true });
    await table[CONVERT_MODULE]();
    expect(api.window.showInformationMessage).not.toHaveBeenCalled();
    expect(api.window.setStatusBarMessage).toHaveBeenCalledWith(
      'Lace: Converted infra/prod: wrote main.tf; already-lace-style; the report is in Problems',
      5000,
    );
  });

  test('a failure offers the way out its reason names', async () => {
    const failure: CommandFailure = { reason: 'unauthenticated', message: 'sign in to Lace' };
    const { table, api, offers } = setup(
      { 'module convert': refused(failure) },
      { answer: 'Sign In' },
    );
    await table[CONVERT_MODULE]();
    expect(shownBy(api.window.showErrorMessage)).toEqual([['sign in to Lace', 'Sign In']]);
    expect(offers.signIn).toHaveBeenCalledOnce();
  });

  test('a root outside a git repository is its failure, with no way out offered', async () => {
    const failure: CommandFailure = {
      reason: 'not_git_repository',
      message:
        'lace module convert writes lace-style tf in place and requires a git repository; run `git init` in /work/repo/infra/prod first',
    };
    const { table, api, invoked } = setup({ 'module convert': refused(failure, 2) });
    await table[CONVERT_MODULE]();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(failure.message);
    expect(api.window.showInformationMessage).not.toHaveBeenCalled();
    expect(invoked.map((each) => each.path)).toEqual(['module convert']);
  });

  test('Terraform it cannot represent offers Validate, which validates the same root', async () => {
    const failure: CommandFailure = {
      reason: 'source_refused',
      message:
        '1 Terraform construct(s) Lace cannot carry; the report names each with what to change',
    };
    const { table, api, invoked } = setup(
      { 'module convert': refused(failure, 2), 'module validate': validated([FINDING]) },
      { answer: 'Validate' },
    );
    await table[CONVERT_MODULE]();
    expect(shownBy(api.window.showErrorMessage)).toEqual([[failure.message, 'Validate']]);
    expect(invoked).toEqual([
      { cwd: PROD, path: 'module convert', args: {} },
      { cwd: PROD, path: 'module validate', args: {} },
    ]);
    expect(api.window.showWarningMessage).toHaveBeenCalledWith(
      'Validated infra/prod: lossy, 1 diagnostic.',
      'Show Report',
    );
  });
});

describe('Format', () => {
  test('reports the files it changed', async () => {
    const { table, api } = setup({
      'module fmt': { documents: [{ changed: ['main.tf', 'variables.tf'] }] },
    });
    await table[FORMAT_MODULE]();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'Formatted 2 files in infra/prod: main.tf, variables.tf.',
    );
  });
});

describe('Generate Docs', () => {
  test('opens the markdown in an untitled editor', async () => {
    const { table, api } = setup({ 'module docs': { documents: [{ markdown: '# vpc\n' }] } });
    await table[GENERATE_DOCS]();
    expect(api.workspace.openTextDocument).toHaveBeenCalledWith({
      language: 'markdown',
      content: '# vpc\n',
    });
    expect(api.window.showTextDocument).toHaveBeenCalledWith({
      opened: { language: 'markdown', content: '# vpc\n' },
    });
  });
});

describe('saving buffers', () => {
  test('is true with nothing to save', async () => {
    expect(
      await saveTerraformBuffers({ textDocuments: [] } as unknown as typeof vscode.workspace, prod),
    ).toBe(true);
  });
});

describe('Save', () => {
  test('saves the open canvas of the root, held for the save', async () => {
    const editor = { save: vi.fn(async () => {}) };
    const { table, api, sessions } = setup({}, { open: true, editor });
    await table[SAVE_CANVAS]();
    expect(editor.save).toHaveBeenCalledOnce();
    expect(sessions.acquire).toHaveBeenCalledWith(PROD);
    expect(sessions.holders()).toBe(0);
    expect(api.window.setStatusBarMessage).toHaveBeenCalledWith(
      'Lace: saved the canvas of infra/prod',
      5000,
    );
  });

  test('finds the root’s open canvas whichever spelling of the root its session was opened with', async () => {
    const editor = { save: vi.fn(async () => {}) };
    const { table, sessions } = setup({}, { open: true, editor, spelled: `${PROD}/` });
    await table[SAVE_CANVAS]();
    expect(editor.save).toHaveBeenCalledOnce();
    expect(sessions.holders()).toBe(0);
  });

  test('with an unfocused canvas open on a directory that holds no Terraform, and no other module, saves that canvas', async () => {
    const editor = { save: vi.fn(async () => {}) };
    const fresh: AuthoringRoot = { folder: repo, relative: 'infra/new' };
    const { table, api, sessions } = setup(
      {},
      { root: undefined, canvases: [fresh], open: true, spelled: '/work/repo/infra/new', editor },
    );
    await table[SAVE_CANVAS]();
    expect(sessions.acquire).toHaveBeenCalledWith('/work/repo/infra/new');
    expect(editor.save).toHaveBeenCalledOnce();
    expect(api.window.setStatusBarMessage).toHaveBeenCalledWith(
      'Lace: saved the canvas of infra/new',
      5000,
    );
  });

  test('a session of another root is no open canvas of this one', async () => {
    const { table, api, sessions } = setup({}, { open: true, spelled: '/work/repo/infra/prod-eu' });
    await table[SAVE_CANVAS]();
    expect(sessions.acquire).not.toHaveBeenCalled();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'infra/prod has no open canvas, so it holds no unsaved edits: nothing was saved.',
    );
  });

  test('with no canvas open, says there is nothing unsaved and holds nothing', async () => {
    const { table, api, sessions } = setup({}, { open: false });
    await table[SAVE_CANVAS]();
    expect(sessions.acquire).not.toHaveBeenCalled();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'infra/prod has no open canvas, so it holds no unsaved edits: nothing was saved.',
    );
  });

  test('a save that fails says so', async () => {
    const editor = { save: vi.fn(async () => Promise.reject(new Error('the disk is full'))) };
    const { table, api, sessions } = setup({}, { open: true, editor });
    await table[SAVE_CANVAS]();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace could not save the canvas of infra/prod: the disk is full',
    );
    expect(sessions.holders()).toBe(0);
  });
});

describe('Generate', () => {
  // An editor whose Generate publishes `events`, the last closing it.
  const generating = (events: GenerateEvent[]) => ({
    save: vi.fn(async () => {}),
    generate: vi.fn(() =>
      (async function* () {
        yield* events;
      })(),
    ),
  });

  test("saves the root's dirty Terraform buffers, generates on a hold, and Show Changes opens Source Control", async () => {
    const editor = generating([
      { type: 'progress', stage: 'generating' },
      { type: 'success', written: ['main.tf'], validate: {} as never },
    ]);
    const { table, api, textDocuments, sessions } = setup(
      {},
      { open: false, editor, answer: 'Show Changes' },
    );
    const buffer = document(`${PROD}/main.tf`, true);
    textDocuments.push(buffer);
    await table[GENERATE_CANVAS]();

    expect(buffer.save).toHaveBeenCalled();
    expect(editor.generate).toHaveBeenCalledOnce();
    expect(sessions.holders()).toBe(0);
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'Generated the Terraform of infra/prod: main.tf.',
      'Show Changes',
    );
    expect(api.commands.executeCommand).toHaveBeenCalledWith('workbench.view.scm');
  });

  test('a Generate that wrote no file says plainly that nothing was written, and offers no changes to show', async () => {
    const editor = generating([{ type: 'success', written: [], validate: {} as never }]);
    const { table, api } = setup({}, { open: false, editor, answer: 'Show Changes' });
    await table[GENERATE_CANVAS]();

    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'Generated the Terraform of infra/prod: nothing was written.',
    );
    expect(api.commands.executeCommand).not.toHaveBeenCalled();
  });

  test('a buffer that does not save generates nothing', async () => {
    const editor = generating([]);
    const { table, api, textDocuments, sessions } = setup({}, { editor });
    textDocuments.push(document(`${PROD}/main.tf`, true, false));
    await table[GENERATE_CANVAS]();
    expect(sessions.acquire).not.toHaveBeenCalled();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'A Terraform file in infra/prod did not save, so Lace did not generate it.',
    );
  });

  test('refused for unsaved edits, by its reason whatever its message, offers Save, which saves the canvas', async () => {
    const editor = generating([
      { type: 'error', message: 'save the session first', reason: Reason.REASON_UNSAVED },
    ]);
    const { table, api } = setup({}, { open: true, editor, answer: 'Save' });
    await table[GENERATE_CANVAS]();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'infra/prod has unsaved canvas edits: Lace generates the saved canvas.',
      'Save',
    );
    expect(editor.save).toHaveBeenCalledOnce();
  });

  test('another reason whose message speaks of unsaved edits offers no Save', async () => {
    const editor = generating([
      {
        type: 'error',
        message: 'the Terraform moved under unsaved edits; keep or reload them',
        reason: Reason.REASON_CONFLICT,
      },
    ]);
    const { table, api } = setup({}, { open: true, editor, answer: 'Save' });
    await table[GENERATE_CANVAS]();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace did not generate infra/prod: the Terraform moved under unsaved edits; keep or reload them',
    );
    expect(editor.save).not.toHaveBeenCalled();
  });

  test('any other refusal says its message', async () => {
    const editor = generating([
      {
        type: 'error',
        message: 'not a git repository',
        reason: Reason.REASON_NOT_GIT_REPOSITORY,
      },
    ]);
    const { table, api } = setup({}, { editor });
    await table[GENERATE_CANVAS]();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      'Lace did not generate infra/prod: not a git repository',
    );
  });
});
