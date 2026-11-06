// The status bar item the account's controls draw, over an account and its
// commands, for a test to read: its text, its tooltip, its command, whether it
// is shown, and the commands the controls registered.
import type { CommandsMapping } from '../../engine/commands-mapping';
import { type Account, accountControls } from '../account';

export function statusBarOver(account: Account, commands: CommandsMapping) {
  const registered: string[] = [];
  const status = {
    text: '',
    tooltip: '',
    command: '',
    visible: false,
    show: () => {
      status.visible = true;
    },
    hide: () => {
      status.visible = false;
    },
    dispose: () => {},
  };
  const controls = accountControls(
    {
      commands: {
        registerCommand: (id: string) => {
          registered.push(id);
          return { dispose: () => {} };
        },
      },
      window: { createStatusBarItem: () => status, showErrorMessage: async () => undefined },
    } as never,
    account,
    commands,
    {} as never,
    () => {},
  );
  return { status, controls, registered };
}
