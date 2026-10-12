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

// The registry sidebar's built stylesheet, as the browser reads it, which
// these tests read no further than its rules' selectors and declarations:
// whether Tab reaches a row's actions and focus shows is the browser's.
describe("the registry sidebar's stylesheet", () => {
  const rules = readFileSync(join(OUT, 'registry-sidebar.css'), 'utf8')
    .split('}')
    .map((rule) => rule.split('{'))
    .map(([selectors = '', declarations = '']) => ({
      selectors,
      declarations: declarations.replace(/\s/g, ''),
    }));
  // A row's actions and what holds them.
  const IN_A_ROW =
    /\.(module-add|module-star|version-toggle|version-row-add|module-actions|version-row)\b/;

  test('never takes a row action, or what holds it, out of the tab order with display: none or visibility: hidden', () => {
    const hiding = rules.filter(
      ({ selectors, declarations }) =>
        IN_A_ROW.test(selectors) && /display:none|visibility:hidden/.test(declarations),
    );
    expect(hiding).toEqual([]);
  });

  test("shows each of a row's actions, at full width, while keyboard focus is in the row", () => {
    // Whether a rule for `action` under keyboard focus in its row declares
    // every one of `declarations`.
    const revealed = (action: string, ...declarations: string[]) =>
      rules.some(
        (rule) =>
          rule.selectors.includes(':has(:focus-visible)') &&
          rule.selectors.includes(action) &&
          declarations.every((declaration) => rule.declarations.includes(declaration)),
      );
    for (const action of ['.module-star', '.module-add', '.version-toggle']) {
      expect(revealed(action, 'width:22px', 'opacity:1'), action).toBe(true);
    }
    expect(revealed('.version-row-add', 'opacity:1')).toBe(true);
  });

  test('draws keyboard focus with the focus border', () => {
    expect(
      rules.some(
        ({ selectors, declarations }) =>
          selectors.includes(':focus-visible') &&
          declarations.includes('var(--vscode-focusBorder)'),
      ),
    ).toBe(true);
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
