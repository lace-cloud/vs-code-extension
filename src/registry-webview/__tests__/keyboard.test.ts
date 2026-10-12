// The registry sidebar's rows from the keyboard: Enter or Space on a row
// activates it, and on a control inside it, such as the row's "+", is that
// control's. The stylesheet that shows the "+" to the keyboard is the built
// one's, read in `src/__tests__/bundles.build.test.ts`.
import { describe, expect, test, vi } from 'vitest';
import { onKey } from '../keys';

// A key pressed on `target` while the handler of `row` listens: whether the
// row ran, and whether the key's own activation was stopped.
function press(key: string, row: object, target: object) {
  const run = vi.fn();
  let prevented = false;
  onKey(run)({ key, target, currentTarget: row, preventDefault: () => (prevented = true) });
  return { ran: run.mock.calls.length > 0, prevented };
}

describe("a row's keys", () => {
  const row = {};

  test.each(['Enter', ' '])('%j on the row activates it as a click does', (key) => {
    expect(press(key, row, row)).toEqual({ ran: true, prevented: true });
  });

  test.each([
    'Enter',
    ' ',
  ])('%j on the row\'s "+" is the "+"\'s: the row neither runs nor stops it', (key) => {
    const plus = {};
    expect(press(key, row, plus)).toEqual({ ran: false, prevented: false });
  });

  test('another key does nothing', () => {
    expect(press('a', row, row)).toEqual({ ran: false, prevented: false });
  });
});
