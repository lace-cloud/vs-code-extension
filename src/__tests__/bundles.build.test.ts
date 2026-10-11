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
