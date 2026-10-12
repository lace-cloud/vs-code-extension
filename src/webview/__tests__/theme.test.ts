import { describe, expect, test } from 'vitest';
import { followTheme, themeOf, type WatchClass } from '../theme';

// A page whose <body> carries VS Code's theme classes, and whose class
// changes reach the watcher `followTheme` is given, as a MutationObserver
// tells them.
function page(...classes: string[]) {
  let current = new Set(classes);
  const attributes = new Map<string, string>();
  const watchers = new Set<() => void>();
  const body = { classList: { contains: (name: string) => current.has(name) } };
  const watch: WatchClass = (element, changed) => {
    expect(element).toBe(body);
    watchers.add(changed);
    return () => watchers.delete(changed);
  };
  return {
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
      body,
    },
    watch,
    theme: () => attributes.get('data-theme'),
    watching: () => watchers.size,
    // VS Code switches the theme: the body's class changes.
    switchTo(...next: string[]) {
      current = new Set(next);
      for (const changed of [...watchers]) changed();
    },
  };
}

describe("a page's theme", () => {
  test.each([
    [['vscode-light'], 'light'],
    [['vscode-dark'], 'dark'],
    [['vscode-high-contrast'], 'dark'],
    // VS Code puts the high-contrast class beside the light one.
    [['vscode-high-contrast', 'vscode-high-contrast-light'], 'light'],
    [['vscode-high-contrast-light'], 'light'],
  ])('under %j is %s', (classes, theme) => {
    expect(themeOf({ contains: (name) => classes.includes(name) })).toBe(theme);
  });

  test("is set on <html> as data-theme from VS Code's class on <body>", () => {
    const light = page('vscode-light');
    followTheme(light.document, light.watch);
    expect(light.theme()).toBe('light');

    const dark = page('vscode-dark');
    followTheme(dark.document, dark.watch);
    expect(dark.theme()).toBe('dark');
  });

  test('follows each theme switch until it is stopped', () => {
    const shown = page('vscode-dark');
    const stop = followTheme(shown.document, shown.watch);

    shown.switchTo('vscode-light');
    expect(shown.theme()).toBe('light');
    shown.switchTo('vscode-high-contrast');
    expect(shown.theme()).toBe('dark');
    shown.switchTo('vscode-high-contrast', 'vscode-high-contrast-light');
    expect(shown.theme()).toBe('light');

    stop();
    expect(shown.watching()).toBe(0);
    shown.switchTo('vscode-dark');
    expect(shown.theme()).toBe('light');
  });
});
