// Reads the bundles `pnpm build` wrote to out/.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const OUT = resolve(__dirname, '..', '..', 'out');

// The modules a bundle was built from, as its source map lists them.
function bundledModules(bundle: string): string[] {
  return JSON.parse(readFileSync(join(OUT, `${bundle}.map`), 'utf8')).sources;
}

// The install locations of `name` among a bundle's modules: one per copy.
function copiesOf(name: string, modules: readonly string[]): string[] {
  const marker = `/node_modules/${name}/`;
  const roots = modules
    .filter((module) => module.includes(marker))
    .map((module) => module.slice(0, module.lastIndexOf(marker)));
  return [...new Set(roots)];
}

describe('the canvas webview bundle', () => {
  const modules = bundledModules('canvas-webview.js');

  test.each(['react', 'react-dom'])('holds exactly one %s', (name) => {
    expect(copiesOf(name, modules)).toHaveLength(1);
  });

  test('holds the canvas', () => {
    expect(copiesOf('@lace-cloud/canvas', modules)).toHaveLength(1);
  });

  test("follows VS Code's theme, which its design tokens read", () => {
    expect(modules.some((module) => module.endsWith('/src/webview/theme.ts'))).toBe(true);
  });
});

describe.each([
  'registry-sidebar.js',
  'module-detail.js',
])('the %s registry page bundle', (bundle) => {
  const modules = bundledModules(bundle);

  test.each(['react', 'react-dom'])('holds exactly one %s', (name) => {
    expect(copiesOf(name, modules)).toHaveLength(1);
  });

  test('holds no canvas and no engine', () => {
    expect(copiesOf('@lace-cloud/canvas', modules)).toEqual([]);
    expect(copiesOf('@lace-cloud/host', modules)).toEqual([]);
  });
});

// The declarations of each rule of a built stylesheet, by every selector
// the rule lists.
function rules(stylesheet: string): Map<string, string[]> {
  const css = readFileSync(join(OUT, stylesheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bySelector = new Map<string, string[]>();
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of selectors.split(',').map((each) => each.trim())) {
      bySelector.set(selector, [...(bySelector.get(selector) ?? []), body]);
    }
  }
  return bySelector;
}

describe("the registry sidebar's stylesheet", () => {
  const sidebar = rules('registry-sidebar.css');
  // Whether a rule for `selector` declares `property: value`.
  const declares = (selector: string, property: string, value: string): boolean =>
    (sidebar.get(selector) ?? []).some((body) =>
      body
        .split(';')
        .map((declaration) => declaration.split(':').map((part) => part.trim()))
        .some(([name, given]) => name === property && given === value),
    );

  test('shows a row\'s "+", star and versions toggle while focus is within the row, as while it is hovered', () => {
    for (const action of ['.module-add', '.module-star', '.version-toggle']) {
      expect(declares(`.module-item:hover ${action}`, 'display', 'flex'), action).toBe(true);
      expect(declares(`.module-item:focus-within ${action}`, 'display', 'flex'), action).toBe(true);
    }
  });

  test('keeps a version row\'s "+" in the tab order, and shows it when it has focus', () => {
    expect(declares('.version-row-add', 'display', 'none')).toBe(false);
    expect(declares('.version-row-add:focus-visible', 'opacity', '1')).toBe(true);
    expect(declares('.version-row:hover .version-row-add', 'opacity', '1')).toBe(true);
  });

  test('draws the focus ring on a row and on each of its actions', () => {
    for (const focusable of ['.module-item', '.module-add', '.module-star', '.version-row-add']) {
      expect(
        declares(`${focusable}:focus-visible`, 'outline', '1px solid var(--vscode-focusBorder)'),
        focusable,
      ).toBe(true);
    }
  });
});

describe('the extension host bundle', () => {
  test('holds no React', () => {
    const modules = bundledModules('extension.js');
    expect(copiesOf('react', modules)).toEqual([]);
    expect(copiesOf('react-dom', modules)).toEqual([]);
  });

  test('loads in Node with vscode stubbed and exports activate', () => {
    const script = `
      const Module = require('node:module');
      const load = Module._load;
      Module._load = (request, ...rest) => (request === 'vscode' ? {} : load(request, ...rest));
      const extension = require(${JSON.stringify(join(OUT, 'extension.js'))});
      process.stdout.write(typeof extension.activate);
    `;
    expect(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })).toBe('function');
  });
});
