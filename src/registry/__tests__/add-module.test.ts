import { describe, expect, test, vi } from 'vitest';
import { fakeCommands, refused, type Script } from '../../engine/__tests__/fake-commands';
import { GUIDE, list, row } from '../../protocol/__tests__/registry-fixtures';
import { type Button, clicked, titleOf } from '../../vscode/__tests__/fake-messages';
import { fakeQuickPicks } from '../../vscode/__tests__/fake-quick-pick';
import type { OfferActions } from '../../vscode/offers';
import { type AddModuleApi, addModuleToCanvas } from '../add-module';
import { registryReads } from '../registry-reads';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

type Item = { label: string; row: { name: string } };

function setup(
  answer: Script,
  picked?: (items: readonly Item[]) => Item | undefined,
  button?: string,
) {
  const commands = fakeCommands({ 'registry list': answer });
  const quickPicks = fakeQuickPicks<Item>((items) => picked?.(items));
  const messages: { level: string; text: string; buttons: string[] }[] = [];
  const message = (level: string) =>
    vi.fn(async (text: string, ...buttons: Button[]) => {
      messages.push({ level, text, buttons: buttons.map(titleOf) });
      return clicked(buttons, button);
    });
  const api = {
    window: {
      createQuickPick: quickPicks.createQuickPick,
      showErrorMessage: message('error'),
      showWarningMessage: message('warn'),
      showInformationMessage: message('info'),
    },
    env: { openExternal: vi.fn(async () => true) },
    Uri: { parse: (value: string) => ({ parsed: value }) },
  };
  const offers: OfferActions = {
    signIn: vi.fn(),
    selectOrganization: vi.fn(),
    selectTeam: vi.fn(),
    openPortal: vi.fn(),
    install: vi.fn(),
    openRecord: vi.fn(),
  };
  const place = vi.fn(async () => {});
  const run = addModuleToCanvas({
    api: api as unknown as AddModuleApi,
    reads: registryReads(commands.commands),
    place,
    offers,
  });
  return { run, api, place, offers, messages, commands, picks: quickPicks.picks };
}

describe('Lace: Add Module to Canvas', () => {
  test('picks among the modules, matching on key and description, and places the one picked at its version', async () => {
    const db = row({ name: 'db', displayName: 'ACME DB', version: '1.4.0' });
    const { run, place, picks } = setup({ documents: [list([row(), db])] }, (items) => items[1]);
    await run();
    expect(picks[0]).toMatchObject({
      placeholder: 'Which module?',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    expect(picks[0].items).toHaveLength(2);
    expect(place).toHaveBeenCalledWith({ author: 'acme', name: 'db', version: '1.4.0' });
  });

  test('the pick is on screen, busy, while the registry is read', async () => {
    const { run, place, picks, commands } = setup({ held: true }, (items) => items[0]);
    const adding = run();
    await settled();
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ visible: true, shownBusy: true, busy: true, items: [] });

    commands.held[0].finish([list([row()])]);
    await adding;
    expect(place).toHaveBeenCalledWith({ author: 'acme', name: 'vpc', version: 'v2.0.0' });
  });

  test('a registry that cannot be read closes the pick and says why, with the ways out its reason names', async () => {
    const { run, place, offers, messages, picks } = setup(
      refused({ reason: 'unauthenticated', message: 'Authentication required' }),
      undefined,
      'Sign In',
    );
    await run();
    expect(messages).toEqual([
      { level: 'error', text: 'Authentication required', buttons: ['Sign In'] },
    ]);
    expect(offers.signIn).toHaveBeenCalledTimes(1);
    expect(picks[0]).toMatchObject({ visible: false, items: [] });
    expect(place).not.toHaveBeenCalled();
  });

  test('an empty registry closes the pick and offers the guide the list carries', async () => {
    const { run, api, messages, picks } = setup(
      { documents: [list([])] },
      undefined,
      'How to publish a module',
    );
    await run();
    await settled();
    expect(picks[0]).toMatchObject({ visible: false, items: [] });
    expect(messages).toEqual([
      {
        level: 'info',
        text: 'No modules are published yet.',
        buttons: ['How to publish a module'],
      },
    ]);
    expect(api.env.openExternal).toHaveBeenCalledWith({ parsed: GUIDE });
  });
});
