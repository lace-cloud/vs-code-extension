import { describe, expect, test, vi } from 'vitest';
import { type Choices, pickFrom } from '../pick';
import { fakeQuickPicks } from './fake-quick-pick';

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

type Item = { label: string; id: string };
const ITEMS: Item[] = [
  { label: 'Prod', id: 'prod' },
  { label: 'Qa', id: 'qa' },
];

// A read the test settles.
function read() {
  let answer: (choices: Choices<Item>) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const choices = new Promise<Choices<Item>>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { choices, answer, fail };
}

function setup() {
  const window = fakeQuickPicks<Item>();
  const reading = read();
  const none = vi.fn();
  const picked = pickFrom(window as never, reading.choices, {
    title: 'Create stack: infra/prod',
    placeholder: 'The cloud connection',
  });
  const [pick] = window.picks;
  return { window, reading, none, picked, pick };
}

describe('a pick whose items come from a read', () => {
  test('is on screen, busy, with its title and placeholder, before its read settles', () => {
    const { window, pick } = setup();
    expect(window.picks).toHaveLength(1);
    expect(pick).toMatchObject({
      visible: true,
      shownBusy: true,
      busy: true,
      items: [],
      title: 'Create stack: infra/prod',
      placeholder: 'The cloud connection',
    });
  });

  test('fills with the items the read answers and stops being busy', async () => {
    const { reading, none, pick } = setup();
    reading.answer({ items: ITEMS, none });
    await settled();
    expect(pick).toMatchObject({ visible: true, busy: false, items: ITEMS });
    expect(pick.placeholder).toBe('The cloud connection');
    expect(none).not.toHaveBeenCalled();
  });

  test('says what the read says over the items, where it says something', async () => {
    const { reading, none, pick } = setup();
    reading.answer({ items: ITEMS, placeholder: 'Set by the environment', none });
    await settled();
    expect(pick.placeholder).toBe('Set by the environment');
  });

  test('answers the item the developer accepts, and closes', async () => {
    const { reading, none, picked, pick } = setup();
    reading.answer({ items: ITEMS, none });
    await settled();
    pick.accept(ITEMS[1]);
    expect(await picked).toBe(ITEMS[1]);
    expect(pick).toMatchObject({ visible: false, disposed: true });
  });

  test('an Enter before the items are in picks nothing and keeps the pick open', async () => {
    const { reading, none, picked, pick } = setup();
    pick.accept();
    await settled();
    expect(pick.visible).toBe(true);
    reading.answer({ items: ITEMS, none });
    await settled();
    pick.accept(ITEMS[0]);
    expect(await picked).toBe(ITEMS[0]);
  });

  test("a read that finds none closes the pick, then runs the caller's none, and answers undefined", async () => {
    const { reading, picked, pick } = setup();
    const visibleAtNone: boolean[] = [];
    reading.answer({ items: [], none: () => visibleAtNone.push(pick.visible) });
    expect(await picked).toBeUndefined();
    expect(visibleAtNone).toEqual([false]);
    expect(pick.disposed).toBe(true);
  });

  test('a read that fails closes the pick and rejects with its error', async () => {
    const { reading, picked, pick } = setup();
    const error = new Error('Sign in to Lace first');
    reading.fail(error);
    await expect(picked).rejects.toBe(error);
    expect(pick).toMatchObject({ visible: false, disposed: true });
  });

  test('a dismissed pick answers undefined at once, and what its read answers after runs nothing', async () => {
    const { reading, none, picked, pick } = setup();
    pick.dismiss();
    expect(await picked).toBeUndefined();
    expect(pick.disposed).toBe(true);
    reading.answer({ items: [], none });
    await settled();
    expect(none).not.toHaveBeenCalled();
  });

  test('a dismissed pick whose read then fails rejects nothing', async () => {
    const { reading, picked, pick } = setup();
    pick.dismiss();
    reading.fail(new Error('Sign in to Lace first'));
    await settled();
    expect(await picked).toBeUndefined();
  });
});
