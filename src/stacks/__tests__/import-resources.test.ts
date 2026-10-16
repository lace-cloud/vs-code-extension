import type { CommandFailure } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { fakeCommands, refused } from '../../engine/__tests__/fake-commands';
import { createRunnerHost } from '../../engine/runner-host';
import { folder, fsPath, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot, RootSources } from '../../roots/authoring-roots';
import { createRootState } from '../../state/root-state';
import { type Button, clicked, titleOf } from '../../vscode/__tests__/fake-messages';
import { fakeQuickPicks } from '../../vscode/__tests__/fake-quick-pick';
import { formAnswerer } from '../../vscode/form-answerer';
import { type OfferActions, offeringPresenter } from '../../vscode/offers';
import { importResourcesCommand, resourceImporter } from '../import-resources';
import { stackPick } from '../stack-pick';
import { memento, stack, stacks } from './stack-fixtures';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };
const STATE = '/home/dev/pulled.tfstate';
const LISTED = { 'stack list': { documents: [stacks(stack('stk_1', 'prod'))] } };
const RESIDUAL: CommandFailure = {
  reason: 'import_residual',
  message: '1 resource has no import id',
  importResiduals: [{ address: 'aws_s3_bucket.logs', type: 'aws_s3_bucket', reason: 'no id' }],
};
const imported = (residuals: CommandFailure['importResiduals'] = []) => ({
  stack: { id: 'stk_1', slug: 'prod' },
  changed: true,
  written: ['main.tf'],
  removed: [],
  diagnostics: [],
  importBlocks: 2,
  importResiduals: residuals,
  validate: {
    root: '/work/repo/infra/prod',
    treeHash: 'h',
    verdict: 'already-lace-style',
    residuals: [],
    exitClass: 'ok',
    diagnostics: [],
  },
});

// A Terraform file of the window, `dirty` while it holds changes the disk
// does not have; its save answers `saves`.
const document = (path: string, dirty: boolean, saves = true) => ({
  uri: uri(path),
  isDirty: dirty,
  save: vi.fn(async () => saves),
});

type Options = {
  scripts: Parameters<typeof fakeCommands>[0];
  documents?: ReturnType<typeof document>[];
  // What each message answers, by its text.
  answers?: Record<string, string>;
};

function setup(options: Options) {
  const commands = fakeCommands(options.scripts);
  const messages: { level: string; text: string; buttons: string[] }[] = [];
  const message = (level: string) =>
    vi.fn(async (text: string, ...buttons: Button[]) => {
      messages.push({ level, text, buttons: buttons.map(titleOf) });
      return clicked(buttons, await options.answers?.[text]);
    });
  // Each progress notification: its title, and whether its task has ended.
  const progress: { title?: string; ended: boolean }[] = [];
  const window = {
    createQuickPick: fakeQuickPicks((items) => items[0]).createQuickPick,
    showOpenDialog: vi.fn(async () => [uri(STATE)]),
    showInputBox: vi.fn(),
    showInformationMessage: message('info'),
    showWarningMessage: message('warn'),
    showErrorMessage: message('error'),
    withProgress: vi.fn(
      async (opened: { title?: string }, task: (p: never, t: never) => unknown) => {
        const entry = { title: opened.title, ended: false };
        progress.push(entry);
        try {
          return await task({ report: () => {} } as never, {} as never);
        } finally {
          entry.ended = true;
        }
      },
    ),
  };
  const api = {
    window,
    workspace: { textDocuments: options.documents ?? [], workspaceFolders: [repo] },
    ProgressLocation: { Notification: 15 },
  };
  const offers: OfferActions = {
    signIn: vi.fn(),
    selectOrganization: vi.fn(),
    selectTeam: vi.fn(),
    openPortal: vi.fn(),
    install: vi.fn(),
    openRecord: vi.fn(),
  };
  const report = vi.fn();
  const sources: RootSources = {
    folders: () => [repo],
    activeCanvas: () => undefined,
    openCanvases: () => [],
    activeTerraformDirectory: () => undefined,
    terraformFiles: async () => [uri('/work/repo/infra/prod/main.tf')],
  };
  const runner = createRunnerHost({
    commands: () => commands.commands.anywhere(),
    presenter: offeringPresenter({
      api: api as never,
      actions: offers,
      confirm: async () => true,
      validate: vi.fn(),
      sources,
      report,
    }),
    answerer: formAnswerer({
      api: api as never,
      commands: commands.commands,
      offers,
      sources,
      report,
    }),
    onRunLog: () => {},
  });
  const pickStack = stackPick({
    api: api as never,
    commands: commands.commands,
    rootState: createRootState(memento()),
    sources,
    offers,
  });
  const importResources = resourceImporter({ api: api as never, sources, runner, pickStack });
  const palette = importResourcesCommand(window as never, sources, importResources);
  const imports = () => commands.invoked.filter(({ path }) => path === 'stack import');
  return { commands, window, messages, progress, importResources, palette, imports };
}

describe('Import Existing Resources', () => {
  test("saves the root's Terraform, then imports into the stack picked with the statefile the form asks for, under a progress notification until its run ends", async () => {
    const edited = document('/work/repo/infra/prod/main.tf', true);
    const elsewhere = document('/work/repo/infra/staging/main.tf', true);
    const t = setup({
      scripts: { ...LISTED, 'stack import': { held: true } },
      documents: [edited, elsewhere],
    });
    const done = t.importResources(prod);
    await settled();

    expect(edited.save).toHaveBeenCalledOnce();
    expect(elsewhere.save).not.toHaveBeenCalled();
    expect(t.imports()).toEqual([
      {
        cwd: fsPath('/work/repo/infra/prod'),
        path: 'stack import',
        args: { stack: 'stk_1', state: fsPath(STATE) },
      },
    ]);
    expect(t.progress).toEqual([{ title: 'Import existing resources: prod', ended: false }]);

    t.commands.held[0].finish([imported()]);
    await done;
    expect(t.progress).toEqual([{ title: 'Import existing resources: prod', ended: true }]);
    expect(t.messages).toEqual([
      {
        level: 'info',
        text: 'Imported 2 resource(s) into prod, rewriting main.tf in place. Review the change in git, commit it, then apply prod to adopt them.',
        buttons: [],
      },
    ]);
  });

  test('stops at a root with no stack, and saves and imports nothing', async () => {
    const edited = document('/work/repo/infra/prod/main.tf', true);
    const t = setup({ scripts: { 'stack list': { documents: [stacks()] } }, documents: [edited] });
    await t.importResources(prod);

    expect(t.messages).toEqual([
      {
        level: 'info',
        text: 'No stack is deployed from infra/prod yet. Create one in the Stacks view.',
        buttons: [],
      },
    ]);
    expect(edited.save).not.toHaveBeenCalled();
    expect(t.imports()).toEqual([]);
    expect(t.progress).toEqual([]);
  });

  test('stops when a Terraform file of the root did not save', async () => {
    const t = setup({
      scripts: { ...LISTED, 'stack import': { documents: [imported()] } },
      documents: [document('/work/repo/infra/prod/main.tf', true, false)],
    });
    await t.importResources(prod);

    expect(t.messages).toEqual([
      {
        level: 'error',
        text: 'A Terraform file in infra/prod did not save, so Lace did not import into prod.',
        buttons: [],
      },
    ]);
    expect(t.imports()).toEqual([]);
  });

  test('a dismissed statefile ends the run and imports nothing', async () => {
    const t = setup({ scripts: { ...LISTED, 'stack import': { documents: [imported()] } } });
    t.window.showOpenDialog.mockResolvedValueOnce(undefined as never);
    await t.importResources(prod);

    expect(t.imports()).toEqual([]);
    expect(t.progress).toEqual([{ title: 'Import existing resources: prod', ended: true }]);
  });

  test('an import that stops at resources it cannot adopt offers Import the rest, which imports past them with the same statefile under a progress notification until its run ends', async () => {
    const t = setup({
      scripts: {
        ...LISTED,
        'stack import': (args) => (args.allowPartial ? { held: true } : refused(RESIDUAL)),
      },
      answers: { '1 resource has no import id': 'Import the rest' },
    });
    await t.importResources(prod);
    await settled();
    await settled();
    expect(t.progress).toEqual([
      { title: 'Import existing resources: prod', ended: true },
      { title: 'Import the rest: prod', ended: false },
    ]);

    t.commands.held[0].finish([imported(RESIDUAL.importResiduals)]);
    await settled();
    await settled();
    expect(t.progress.at(-1)).toEqual({ title: 'Import the rest: prod', ended: true });

    expect(t.messages[0]).toEqual({
      level: 'error',
      text: '1 resource has no import id',
      buttons: ['Import the rest'],
    });
    expect(t.window.showOpenDialog).toHaveBeenCalledOnce();
    expect(t.imports().map(({ args }) => args)).toEqual([
      { stack: 'stk_1', state: fsPath(STATE) },
      { stack: 'stk_1', allowPartial: true, state: fsPath(STATE) },
    ]);
  });

  test('from the palette, imports into a stack of the root it is pointed at', async () => {
    const t = setup({ scripts: { ...LISTED, 'stack import': { documents: [imported()] } } });
    await t.palette(uri('/work/repo/infra/prod'));
    expect(t.imports().map(({ cwd }) => cwd)).toEqual([fsPath('/work/repo/infra/prod')]);
  });

  test('from the palette, with no module to name, says why and imports nothing', async () => {
    const t = setup({ scripts: LISTED });
    await t.palette(uri('/work/repo/.terraform'));
    expect(t.messages).toEqual([
      {
        level: 'info',
        text: 'No module to import existing resources into: .terraform is a .terraform directory, which is not a module directory.',
        buttons: [],
      },
    ]);
    expect(t.commands.invoked).toEqual([]);
  });
});
