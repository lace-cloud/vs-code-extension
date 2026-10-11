import { describe, expect, test, vi } from 'vitest';
import { createConfirm } from '../dialogs';

type Validate = (value: string) => string | undefined;

function fakeWindow(
  answer: string | undefined,
  typed?: (validate: Validate) => string | undefined,
) {
  return {
    showWarningMessage: vi.fn(async () => answer),
    showInputBox: vi.fn(async (options: { validateInput: Validate }) =>
      typed?.(options.validateInput),
    ),
  };
}

describe('confirm', () => {
  test('a plain confirmation is one modal question, true only for its button', async () => {
    const yes = fakeWindow('Confirm');
    expect(await createConfirm(yes as never)({ text: 'Apply to prod?' })).toBe(true);
    expect(yes.showWarningMessage).toHaveBeenCalledWith(
      'Apply to prod?',
      { modal: true },
      'Confirm',
    );
    expect(yes.showInputBox).not.toHaveBeenCalled();

    expect(await createConfirm(fakeWindow(undefined) as never)({ text: 'Apply to prod?' })).toBe(
      false,
    );
  });

  test('a typed confirmation accepts only the exact value', async () => {
    const window = fakeWindow(undefined, (validate) => {
      expect(validate('Demo')).toBe('Type demo to confirm');
      expect(validate('')).toBe('Type demo to confirm');
      expect(validate('demo')).toBeUndefined();
      return 'demo';
    });
    expect(await createConfirm(window as never)({ text: 'Destroy demo?', typed: 'demo' })).toBe(
      true,
    );
    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });

  test('a dismissed typed confirmation is false', async () => {
    const window = fakeWindow(undefined, () => undefined);
    expect(await createConfirm(window as never)({ text: 'Destroy demo?', typed: 'demo' })).toBe(
      false,
    );
  });
});
