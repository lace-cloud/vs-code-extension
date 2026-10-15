import type { CommandFailure, RunCtx } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { fakeCommands, refused } from '../../engine/__tests__/fake-commands';
import { binding, createRunnerHost, type Form } from '../../engine/runner-host';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import { formAnswerer } from '../form-answerer';
import { type OfferActions, offeringPresenter } from '../offers';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const repo = folder('/work/repo');
const PROD = '/work/repo/infra/prod';
const STACK = { id: 'stk_1', slug: 'prod' };
const PORTAL = 'https://portal/o/acme/t/platform/connections/new';

const connection = (id: string, name: string, status = 'ready') => ({
  id,
  name,
  provider_type: 'aws',
  status,
  status_reason: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  metadata: {},
});
const connections = (...items: ReturnType<typeof connection>[]) => ({ items, createUrl: PORTAL });

type Options = {
  scripts?: Parameters<typeof fakeCommands>[0];
  // What each input box answers, in order: a value, or a promise of one.
  inputs?: (string | undefined | Promise<string | undefined>)[];
  // The id of the item each quick pick picks, in order.
  picks?: (string | undefined)[];
  // The files each open dialog answers, in order.
  files?: (string[] | undefined)[];
  // What each message answers, by its text.
  answers?: Record<string, string>;
};

function setup(options: Options = {}) {
  const commands = fakeCommands(options.scripts ?? {});
  const asked: { kind: string; options: unknown; items?: unknown }[] = [];
  const messages: { level: string; text: string; buttons: string[] }[] = [];
  const message = (level: string) =>
    vi.fn(async (text: string, ...buttons: string[]) => {
      messages.push({ level, text, buttons });
      return options.answers?.[text];
    });
  const window = {
    showInputBox: vi.fn(async (opened: vscode.InputBoxOptions) => {
      asked.push({ kind: 'input', options: opened });
      return options.inputs?.shift();
    }),
    showQuickPick: vi.fn(async (items: { id: string }[], opened: vscode.QuickPickOptions) => {
      asked.push({ kind: 'pick', options: opened, items });
      const id = options.picks?.shift();
      return items.find((item) => item.id === id);
    }),
    withProgress: vi.fn(async (_opened: unknown, task: () => Promise<unknown>) => task()),
    showOpenDialog: vi.fn(async (opened: vscode.OpenDialogOptions) => {
      asked.push({ kind: 'file', options: opened });
      return options.files?.shift()?.map((path) => uri(path));
    }),
    showInformationMessage: message('info'),
    showWarningMessage: message('warn'),
    showErrorMessage: message('error'),
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
  const answerer = formAnswerer({
    api: { window: window as never },
    commands: commands.commands,
    offers,
    sources: { folders: () => [repo] },
    report,
  });
  // Answers a form of the package's action `id` over `ctx`.
  const answer = (id: string, missing: string[], ctx: RunCtx) => {
    const form = { path: 'stack create', missing, submit: vi.fn(), cancel: vi.fn() } as Form & {
      submit: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    };
    answerer(form, { action: binding(id), ctx });
    return form;
  };
  return { commands, window, asked, messages, offers, report, answerer, answer };
}

describe('the answerer', () => {
  test('asks for the slug in an input box titled by the action and the root, which refuses an empty value', async () => {
    const t = setup({ inputs: ['prod'] });
    const form = t.answer('create', ['slug'], { root: PROD });
    await settled();

    expect(t.asked).toEqual([
      {
        kind: 'input',
        options: {
          title: 'Create stack: infra/prod',
          prompt: "The new stack's slug",
          validateInput: expect.any(Function),
        },
      },
    ]);
    const { validateInput } = t.window.showInputBox.mock.calls[0][0];
    expect(validateInput?.('')).toBe("Type the stack's slug");
    expect(validateInput?.('prod')).toBeUndefined();
    expect(form.submit).toHaveBeenCalledWith({ slug: 'prod' });
  });

  test('asks for the connection by a pick of what the CLI lists, nothing filtered, and submits the id picked', async () => {
    const t = setup({
      scripts: {
        'connection list': {
          documents: [
            connections(connection('conn_1', 'AWS prod'), connection('conn_2', 'Old', 'failed')),
          ],
        },
      },
      picks: ['conn_2'],
    });
    const form = t.answer('create', ['connection'], { root: PROD });
    await settled();

    expect(t.commands.invoked).toEqual([{ cwd: '/home/dev', path: 'connection list', args: {} }]);
    expect(t.asked).toEqual([
      {
        kind: 'pick',
        options: {
          title: 'Create stack: infra/prod',
          placeHolder: 'The cloud connection the stack deploys through',
        },
        items: [
          { label: 'AWS prod', description: 'aws · ready · conn_1', id: 'conn_1' },
          { label: 'Old', description: 'aws · failed · conn_2', id: 'conn_2' },
        ],
      },
    ]);
    expect(form.submit).toHaveBeenCalledWith({ connection: 'conn_2' });
  });

  test('asks for each argument in the order the form lists them, and submits them together', async () => {
    const t = setup({
      scripts: { 'connection list': { documents: [connections(connection('conn_1', 'AWS'))] } },
      inputs: ['prod'],
      picks: ['conn_1'],
    });
    const form = t.answer('create', ['slug', 'connection'], { root: PROD });
    await settled();

    expect(t.asked.map(({ kind }) => kind)).toEqual(['input', 'pick']);
    expect(form.submit).toHaveBeenCalledOnce();
    expect(form.submit).toHaveBeenCalledWith({ slug: 'prod', connection: 'conn_1' });
    expect(form.cancel).not.toHaveBeenCalled();
  });

  test('asks for the statefile in an open dialog for one file of any name, at the root, titled by the action and the stack', async () => {
    const t = setup({ files: [['/home/dev/pulled.tfstate']] });
    const form = t.answer('import', ['state'], { root: PROD, stack: STACK });
    await settled();

    expect(t.asked).toEqual([
      {
        kind: 'file',
        options: {
          title: 'Import existing resources: prod',
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          defaultUri: expect.objectContaining({ path: PROD }),
        },
      },
    ]);
    expect(form.submit).toHaveBeenCalledWith({ state: '/home/dev/pulled.tfstate' });
  });

  test.each([
    ['the slug', ['slug', 'connection'], {}],
    ['the connection', ['connection'], { picks: [undefined] }],
    ['the statefile', ['state'], { files: [undefined] }],
  ])('a dismissed prompt for %s cancels the form and asks nothing after it', async (_what, missing, given) => {
    const t = setup({
      scripts: { 'connection list': { documents: [connections(connection('conn_1', 'AWS'))] } },
      ...given,
    });
    const form = t.answer('create', missing, { root: PROD });
    await settled();

    expect(form.cancel).toHaveBeenCalledOnce();
    expect(form.submit).not.toHaveBeenCalled();
    expect(t.asked).toHaveLength(1);
  });

  test('an empty connection list cancels the form and says a connection is added in the portal, with Open Portal on the page the list names', async () => {
    const said =
      'The team has no cloud connection yet. Add one in the portal, then create the stack.';
    const t = setup({
      scripts: { 'connection list': { documents: [connections()] } },
      inputs: ['prod'],
      answers: { [said]: 'Open Portal' },
    });
    const form = t.answer('create', ['slug', 'connection'], { root: PROD });
    await settled();

    expect(form.cancel).toHaveBeenCalledOnce();
    expect(form.submit).not.toHaveBeenCalled();
    expect(t.messages).toEqual([{ level: 'info', text: said, buttons: ['Open Portal'] }]);
    expect(t.offers.openPortal).toHaveBeenCalledWith({ kind: 'openPortal', url: PORTAL });
  });

  test('a connection list that cannot be read cancels the form and says why, with the ways out its reason names', async () => {
    const failure: CommandFailure = { reason: 'unauthenticated', message: 'Sign in to Lace first' };
    const t = setup({
      scripts: { 'connection list': refused(failure) },
      answers: { 'Sign in to Lace first': 'Sign In' },
    });
    const form = t.answer('create', ['connection'], { root: PROD });
    await settled();

    expect(form.cancel).toHaveBeenCalledOnce();
    expect(t.messages).toEqual([
      { level: 'error', text: 'Sign in to Lace first', buttons: ['Sign In'] },
    ]);
    expect(t.offers.signIn).toHaveBeenCalled();
    expect(t.asked).toEqual([]);
  });

  test('an argument with no prompt cancels the form, asks nothing and says this window cannot ask for it', async () => {
    const t = setup();
    const form = t.answer('create', ['slug', 'region'], { root: PROD });
    await settled();

    expect(form.cancel).toHaveBeenCalledOnce();
    expect(t.asked).toEqual([]);
    expect(t.messages).toEqual([
      {
        level: 'warn',
        text: 'Create stack needs region, which this window cannot ask for',
        buttons: [],
      },
    ]);
  });
});

describe("the answerer of the window's runner", () => {
  // The window's runner over `scripts`, with the answerer of `t`.
  function window(t: ReturnType<typeof setup>) {
    return createRunnerHost({
      commands: () => t.commands.commands.anywhere(),
      presenter: offeringPresenter({
        api: {
          window: t.window as never,
          workspace: { workspaceFolders: [repo] },
          ProgressLocation: { Notification: 15 } as never,
        },
        actions: t.offers,
        confirm: async () => true,
        validate: vi.fn(),
        sources: { folders: () => [repo] },
        report: t.report,
      }),
      answerer: t.answerer,
      onRunLog: () => {},
    });
  }

  test("asks no statefile of a run over a failed run's context: Import the rest reads the one that run was given", async () => {
    const t = setup({
      scripts: {
        'stack import': (args) =>
          args.allowPartial
            ? { documents: [] }
            : refused({
                reason: 'import_residual',
                message: '1 resource has no import id',
                importResiduals: [
                  { address: 'aws_s3_bucket.logs', type: 'aws_s3_bucket', reason: 'no id' },
                ],
              }),
      },
      files: [['/home/dev/pulled.tfstate']],
      answers: { 'Error: 1 resource has no import id\n': 'Import the rest' },
    });
    await window(t).run(binding('import'), { root: PROD, stack: STACK });
    await settled();
    await settled();

    expect(t.asked.map(({ kind }) => kind)).toEqual(['file']);
    expect(t.commands.invoked.map(({ args }) => args)).toEqual([
      { stack: 'stk_1', state: '/home/dev/pulled.tfstate' },
      { stack: 'stk_1', allowPartial: true, state: '/home/dev/pulled.tfstate' },
    ]);
  });

  test("a superseded form's prompts settle to nothing: only the newer form's run starts", async () => {
    let typeFirst: (slug: string) => void = () => {};
    const t = setup({
      scripts: {
        'connection list': { documents: [connections(connection('conn_1', 'AWS'))] },
        'stack create': { documents: [] },
      },
      inputs: [new Promise((resolve) => (typeFirst = resolve)), 'b'],
      picks: ['conn_1', 'conn_1'],
    });
    const runner = window(t);
    await runner.run(binding('create'), { root: '/work/repo/a' });
    await runner.run(binding('create'), { root: '/work/repo/b' });
    await settled();
    typeFirst('a');
    await settled();

    expect(t.commands.invoked.filter(({ path }) => path === 'stack create')).toEqual([
      {
        cwd: '/work/repo/b',
        path: 'stack create',
        args: { source: '/work/repo/b', slug: 'b', connection: 'conn_1' },
      },
    ]);
  });
});
