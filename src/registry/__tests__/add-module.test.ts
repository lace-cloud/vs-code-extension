import { describe, expect, test, vi } from 'vitest';
import { fakeCommands, refused, type Script } from '../../engine/__tests__/fake-commands';
import { GUIDE, list, row } from '../../protocol/__tests__/registry-fixtures';
import { type AddModuleApi, addModuleToCanvas } from '../add-module';
import { registryReads } from '../registry-reads';

function setup(answer: Script, picked?: (items: { row: unknown }[]) => unknown, button?: string) {
  const { commands } = fakeCommands({ 'registry list': answer });
  const api = {
    window: {
      showQuickPick: vi.fn(async (items: { row: unknown }[]) => picked?.(items)),
      showErrorMessage: vi.fn(async () => button),
      showInformationMessage: vi.fn(async () => button),
      withProgress: (_o: unknown, task: () => Promise<unknown>) => task(),
    },
    commands: { executeCommand: vi.fn(async () => undefined) },
    env: { openExternal: vi.fn(async () => true) },
    Uri: { parse: (value: string) => ({ parsed: value }) },
    ProgressLocation: { Window: 10 },
  };
  const place = vi.fn(async () => {});
  const run = addModuleToCanvas({
    api: api as unknown as AddModuleApi,
    reads: registryReads(commands),
    place,
  });
  return { run, api, place };
}

describe('Lace: Add Module to Canvas', () => {
  test('picks among the modules and places the one picked at its version', async () => {
    const db = row({ name: 'db', displayName: 'ACME DB', version: '1.4.0' });
    const { run, place, api } = setup({ documents: [list([row(), db])] }, (items) => items[1]);
    await run();
    expect(api.window.showQuickPick.mock.calls[0][0]).toHaveLength(2);
    expect(place).toHaveBeenCalledWith({ author: 'acme', name: 'db', version: '1.4.0' });
  });

  test('signed out offers Sign In', async () => {
    const { run, api, place } = setup(
      refused({ reason: 'unauthenticated', message: 'Authentication required' }),
      undefined,
      'Sign In',
    );
    await run();
    expect(api.commands.executeCommand).toHaveBeenCalledWith('lace.signIn');
    expect(place).not.toHaveBeenCalled();
  });

  test('an empty registry offers the guide the list carries', async () => {
    const { run, api } = setup({ documents: [list([])] }, undefined, 'How to publish a module');
    await run();
    expect(api.env.openExternal).toHaveBeenCalledWith({ parsed: GUIDE });
  });
});
