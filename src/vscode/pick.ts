// A quick pick whose items come from a read: on screen at once, busy, with
// its title and placeholder, and filled when the read settles, so the
// developer sees the command go on while it reads. A read that finds
// nothing closes the pick and runs the caller's `none`: no pick is shown
// empty. A read that fails closes the pick, which rejects with the read's
// error for the caller's notice. A pick the developer dismisses answers
// undefined at once, and what its read answers after that has no reader.
// An Enter before the items are in picks nothing. `showQuickPick` stays
// where the items are in hand.
import type * as vscode from 'vscode';

// What a pick's read answers: the items to pick among, what the pick says
// over them where the read decides that, and what the caller says when
// there are none.
export type Choices<I extends vscode.QuickPickItem> = {
  items: readonly I[];
  placeholder?: string;
  none: () => void;
};

// What the pick says and how it filters, from the moment it is shown.
export type PickOptions = Partial<
  Pick<
    vscode.QuickPick<vscode.QuickPickItem>,
    'title' | 'placeholder' | 'matchOnDescription' | 'matchOnDetail'
  >
>;

export function pickFrom<I extends vscode.QuickPickItem>(
  window: Pick<typeof vscode.window, 'createQuickPick'>,
  choices: Promise<Choices<I>>,
  options: PickOptions,
): Promise<I | undefined> {
  const pick = window.createQuickPick<I>();
  Object.assign(pick, options, { busy: true });
  return new Promise((resolve, reject) => {
    let open = true;
    const close = () => {
      open = false;
      pick.dispose();
    };
    pick.onDidHide(() => {
      if (!open) return;
      close();
      resolve(undefined);
    });
    pick.onDidAccept(() => {
      const [chosen] = pick.selectedItems;
      if (chosen === undefined) return;
      close();
      resolve(chosen);
    });
    choices.then(
      ({ items, placeholder, none }) => {
        if (!open) return;
        if (items.length === 0) {
          close();
          resolve(undefined);
          none();
          return;
        }
        pick.items = items;
        pick.placeholder = placeholder ?? pick.placeholder;
        pick.busy = false;
      },
      (error: unknown) => {
        if (!open) return;
        close();
        reject(error);
      },
    );
    pick.show();
  });
}
