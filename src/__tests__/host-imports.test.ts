// The extension host bundle loads in Node with no DOM: everything reachable
// from `src/extension.ts` imports the React-free `@lace-cloud/canvas/engine`,
// never the canvas barrel, React or a stylesheet.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const ALLOWED = [
  'vscode',
  '@lace-cloud/host',
  '@lace-cloud/canvas/engine',
  '@lace-cloud/proto',
  '@lace-cloud/chat-core',
];

const allowed = (specifier: string): boolean =>
  specifier.startsWith('node:') || ALLOWED.includes(specifier);

// The TypeScript module a relative specifier names, if it names one.
function sourceModule(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = join(dirname(from), specifier);
  return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(existsSync);
}

// Every import reachable from `entry` that is not one of this repository's
// TypeScript modules — a package, or a file of another kind — with the file
// that names it.
function outsideImports(entry: string): Map<string, string> {
  const seen = new Set<string>();
  const outside = new Map<string, string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { fileName } of ts.preProcessFile(readFileSync(file, 'utf8')).importedFiles) {
      const module = sourceModule(file, fileName);
      if (module) visit(module);
      else outside.set(fileName, file);
    }
  };
  visit(entry);
  return outside;
}

describe('extension host imports', () => {
  test('everything the host reaches is a host-side module', () => {
    const offenders = [...outsideImports(join(ROOT, 'src', 'extension.ts'))]
      .filter(([specifier]) => !allowed(specifier))
      .map(([specifier, file]) => `${file.slice(ROOT.length + 1)} imports ${specifier}`);
    expect(offenders).toEqual([]);
  });

  test('the canvas barrel, React and a stylesheet are not host-side modules', () => {
    for (const specifier of ['@lace-cloud/canvas', 'react', 'react-dom/client', './entry.css']) {
      expect(allowed(specifier)).toBe(false);
    }
  });

  test('the webview entry is where the canvas barrel is imported', () => {
    const webview = outsideImports(join(ROOT, 'src', 'canvas-webview', 'entry.tsx'));
    expect([...webview.keys()]).toContain('@lace-cloud/canvas');
  });
});
