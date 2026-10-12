// The keyboard of the registry pages' clickable elements that are not
// buttons (a row, a section's header): Enter and Space activate one as a
// click does. A key pressed on a control inside it, such as a row's "+", is
// that control's, so the element neither runs nor stops the control's own
// activation.
type KeyEvent = {
  readonly key: string;
  readonly target: unknown;
  readonly currentTarget: unknown;
  preventDefault: () => void;
};

export const onKey =
  (run: () => void) =>
  (event: KeyEvent): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    run();
  };
