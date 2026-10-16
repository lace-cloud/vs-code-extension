import { CommandUnobservedError, type LaceReason } from '@lace-cloud/canvas/engine';
import { describe, expect, test, vi } from 'vitest';
import { fakeCommands, refused } from '../../engine/__tests__/fake-commands';
import { folder, fsPath } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot } from '../../roots/authoring-roots';
import { createRootState } from '../../state/root-state';
import { type Button, clicked, titleOf } from '../../vscode/__tests__/fake-messages';
import { fakeQuickPicks } from '../../vscode/__tests__/fake-quick-pick';
import type { OfferActions } from '../../vscode/offers';
import { stackPick } from '../stack-pick';
import { memento, stack, stacks } from './stack-fixtures';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const repo = folder('/work/repo');
const prod: AuthoringRoot = { folder: repo, relative: 'infra/prod' };

function setup(
  scripts: Parameters<typeof fakeCommands>[0],
  options: { pick?: string; answer?: string } = {},
) {
  const commands = fakeCommands(scripts);
  const messages: { level: string; text: string; buttons: string[] }[] = [];
  const message = (level: string) =>
    vi.fn(async (text: string, ...buttons: Button[]) => {
      messages.push({ level, text, buttons: buttons.map(titleOf) });
      return clicked(buttons, await options.answer);
    });
  const quickPicks = fakeQuickPicks<{
    label: string;
    description?: string;
    stack: { slug: string };
  }>((items) => items.find((item) => item.stack.slug === options.pick));
  const window = {
    createQuickPick: quickPicks.createQuickPick,
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
  const rootState = createRootState(memento());
  const pickStack = stackPick({
    api: { window: window as never },
    commands: commands.commands,
    rootState,
    sources: { folders: () => [repo] },
    offers,
  });
  return { commands, window, messages, offers, rootState, pickStack, picks: quickPicks.picks };
}

describe('the stack pick', () => {
  test("lists the root's stacks in the home, the one on its canvas marked, and gives the one picked", async () => {
    const t = setup(
      { 'stack list': { documents: [stacks(stack('stk_1', 'prod'), stack('stk_2', 'qa'))] } },
      { pick: 'qa' },
    );
    await t.rootState.pickStack(prod, { id: 'stk_1', slug: 'prod' });

    expect(await t.pickStack(prod, 'import into')).toEqual({ id: 'stk_2', slug: 'qa' });
    expect(t.commands.invoked).toEqual([
      { cwd: '/home/dev', path: 'stack list', args: { source: fsPath('/work/repo/infra/prod') } },
    ]);
    const [pick] = t.picks;
    expect(pick.items.map(({ label, description }) => ({ label, description }))).toEqual([
      { label: 'Prod', description: 'prod · on the canvas' },
      { label: 'Qa', description: 'qa' },
    ]);
    expect(pick.placeholder).toBe('The stack deployed from infra/prod to import into');
  });

  test('is on screen, busy, while the stacks are listed', async () => {
    const t = setup({ 'stack list': { held: true } }, { pick: 'prod' });
    const picking = t.pickStack(prod, 'preview');
    await settled();
    expect(t.picks).toHaveLength(1);
    expect(t.picks[0]).toMatchObject({
      visible: true,
      shownBusy: true,
      busy: true,
      items: [],
      placeholder: 'The stack deployed from infra/prod to preview',
    });

    t.commands.held[0].finish([stacks(stack('stk_1', 'prod'))]);
    expect(await picking).toEqual({ id: 'stk_1', slug: 'prod' });
  });

  test('a dismissed pick gives no stack', async () => {
    const t = setup({ 'stack list': { documents: [stacks(stack('stk_1', 'prod'))] } });
    expect(await t.pickStack(prod, 'preview')).toBeUndefined();
  });

  test('a root with no stack says so and where one is created, and leaves no pick open', async () => {
    const t = setup({ 'stack list': { documents: [stacks()] } });
    expect(await t.pickStack(prod, 'preview')).toBeUndefined();
    expect(t.messages).toEqual([
      {
        level: 'info',
        text: 'No stack is deployed from infra/prod yet. Create one in the Stacks view.',
        buttons: [],
      },
    ]);
    expect(t.picks[0]).toMatchObject({ visible: false, items: [] });
  });

  test('a list that cannot be read closes the pick and says why, with the ways out its reason names', async () => {
    const reason: LaceReason = 'no_team';
    const t = setup(
      {
        'stack list': refused({
          reason,
          message: 'No team is selected',
          url: 'https://portal/teams/new',
        }),
      },
      { answer: 'Select Team' },
    );
    expect(await t.pickStack(prod, 'apply')).toBeUndefined();
    expect(t.messages).toEqual([
      { level: 'error', text: 'No team is selected', buttons: ['Select Team', 'Open Portal'] },
    ]);
    expect(t.offers.selectTeam).toHaveBeenCalled();
    expect(t.picks[0]).toMatchObject({ visible: false, items: [] });
  });

  test('a list whose stream ended before it finished closes the pick and says to list again', async () => {
    const t = setup({ 'stack list': { fails: new CommandUnobservedError('stack list') } });
    expect(await t.pickStack(prod, 'apply')).toBeUndefined();
    expect(t.messages).toEqual([
      {
        level: 'error',
        text: "the engine's stream ended before `lace stack list` exited; run it again",
        buttons: [],
      },
    ]);
    expect(t.picks[0]).toMatchObject({ visible: false, items: [] });
  });
});
