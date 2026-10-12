// A webview page's theme, as Lace's design tokens read it: `data-theme` on
// <html>, `light` under a light VS Code theme and `dark` under a dark one.
// VS Code names its theme by a class on <body> (`vscode-light`,
// `vscode-dark`, `vscode-high-contrast`, `vscode-high-contrast-light`, the
// last beside `vscode-high-contrast`) and changes that class when the
// developer switches theme; the page follows it.
export type Theme = 'light' | 'dark';

type ClassList = { contains: (name: string) => boolean };

type ThemedDocument = {
  readonly documentElement: { setAttribute: (name: string, value: string) => void };
  readonly body: { readonly classList: ClassList };
};

// Calls `changed` each time `element`'s class attribute changes, until the
// returned function stops it.
export type WatchClass = (element: ThemedDocument['body'], changed: () => void) => () => void;

export function themeOf(classes: ClassList): Theme {
  return classes.contains('vscode-light') || classes.contains('vscode-high-contrast-light')
    ? 'light'
    : 'dark';
}

const observeClass: WatchClass = (element, changed) => {
  const observer = new MutationObserver(changed);
  // The page's <body>, which this watcher is only ever handed.
  observer.observe(element as unknown as Node, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

// Sets `data-theme` on the page's <html> from VS Code's class on <body>,
// now and at each theme switch, until the returned function stops it.
export function followTheme(
  document: ThemedDocument,
  watchClass: WatchClass = observeClass,
): () => void {
  const apply = () =>
    document.documentElement.setAttribute('data-theme', themeOf(document.body.classList));
  apply();
  return watchClass(document.body, apply);
}
