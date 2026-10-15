// VS Code's quick pick (`window.createQuickPick`) as a test drives it. A
// pick is on screen from `show()` until it is hidden: by `hide()`, by
// `dispose()`, which hides a pick still shown, or by the developer, who
// dismisses it (`dismiss`, Escape). Each hiding fires `onDidHide` once.
// The developer accepting (`accept`, Enter) fires `onDidAccept` with the
// item selected, none while the pick lists nothing, and leaves the pick
// shown, as VS Code does. Every pick made is kept in `picks`, with whether
// it was busy when it came on screen (`shownBusy`).
//
// Given `answer`, the developer answers each pick once its items are in:
// the item `answer` gives is accepted, and none dismisses the pick.
type Listener = () => void;

type Item = { readonly label: string };

export class FakeQuickPick<I extends Item = Item> {
  title: string | undefined;
  placeholder: string | undefined;
  busy = false;
  matchOnDescription = false;
  matchOnDetail = false;
  selectedItems: readonly I[] = [];
  visible = false;
  disposed = false;
  shownBusy: boolean | undefined;
  #items: readonly I[] = [];
  readonly #accepted = new Set<Listener>();
  readonly #hidden = new Set<Listener>();

  constructor(private readonly answer?: (items: readonly I[]) => I | undefined) {}

  get items(): readonly I[] {
    return this.#items;
  }

  set items(items: readonly I[]) {
    this.#items = items;
    const { answer } = this;
    if (answer === undefined || items.length === 0) return;
    queueMicrotask(() => {
      if (!this.visible) return;
      const chosen = answer(items);
      if (chosen === undefined) this.dismiss();
      else this.accept(chosen);
    });
  }

  onDidAccept = (listener: Listener) => FakeQuickPick.#listen(this.#accepted, listener);
  onDidHide = (listener: Listener) => FakeQuickPick.#listen(this.#hidden, listener);

  show(): void {
    this.visible = true;
    this.shownBusy ??= this.busy;
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    for (const listener of [...this.#hidden]) listener();
  }

  dispose(): void {
    this.hide();
    this.disposed = true;
    this.#accepted.clear();
    this.#hidden.clear();
  }

  // The developer presses Enter on `item`, or on a pick that lists nothing.
  accept(item?: I): void {
    this.selectedItems = item === undefined ? [] : [item];
    for (const listener of [...this.#accepted]) listener();
  }

  // The developer presses Escape.
  dismiss(): void {
    this.hide();
  }

  static #listen(listeners: Set<Listener>, listener: Listener) {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  }
}

export function fakeQuickPicks<I extends Item = Item>(
  answer?: (items: readonly I[]) => I | undefined,
) {
  const picks: FakeQuickPick<I>[] = [];
  const createQuickPick = () => {
    const pick = new FakeQuickPick<I>(answer);
    picks.push(pick);
    return pick;
  };
  return { createQuickPick, picks };
}
