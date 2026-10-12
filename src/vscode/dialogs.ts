// The VS Code dialogs the canvas's `presenter.confirm` runs through: a
// modal question with one confirming button, or, for a typed confirmation,
// one input box that resolves true only for the exact value.
import type { ConfirmSpec } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';

type DialogsApi = Pick<typeof vscode.window, 'showWarningMessage' | 'showInputBox'>;

const CONFIRM = 'Confirm';

export function createConfirm(window: DialogsApi): (spec: ConfirmSpec) => Promise<boolean> {
  return async (spec) => {
    if (spec.typed === undefined) {
      const answer = await window.showWarningMessage(spec.text, { modal: true }, CONFIRM);
      return answer === CONFIRM;
    }
    const expected = spec.typed;
    const typed = await window.showInputBox({
      prompt: spec.text,
      placeHolder: expected,
      validateInput: (value) => (value === expected ? undefined : `Type ${expected} to confirm`),
    });
    return typed === expected;
  };
}
