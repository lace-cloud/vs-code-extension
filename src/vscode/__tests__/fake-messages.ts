// VS Code's message boxes as a test drives them. A button is a string or an
// item, called by its title; VS Code hands back the button clicked itself,
// so a test that clicks a button by its title gets back that button
// (`clicked`), and reads what a box showed as its text and its buttons'
// titles (`shownBy`).
export type Button = string | { readonly title: string };

export const titleOf = (button: Button): string =>
  typeof button === 'string' ? button : button.title;

// The button of `buttons` titled `title`, as VS Code hands back the one
// clicked; none when the box was dismissed.
export function clicked<B extends Button>(
  buttons: readonly B[],
  title: string | undefined,
): B | undefined {
  return buttons.find((button) => titleOf(button) === title);
}

// Each message a mocked box showed: its text, then its buttons' titles.
export function shownBy(box: { mock: { calls: unknown[][] } }): string[][] {
  return box.mock.calls.map(([text, ...buttons]) => [
    String(text),
    ...(buttons as Button[]).map(titleOf),
  ]);
}
