// The README is the extension's Marketplace page: it names every command,
// setting and chat tool the manifest contributes, so a contribution cannot
// ship without the page saying what it is.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

const unnamed = (ids: readonly string[]): string[] =>
  ids.filter((id) => !readme.includes(`\`${id}\``));

describe('the README', () => {
  test('names every contributed command by its id', () => {
    const ids = manifest.contributes.commands.map((c: { command: string }) => c.command);
    expect(unnamed(ids)).toEqual([]);
  });

  test('names every contributed setting', () => {
    expect(unnamed(Object.keys(manifest.contributes.configuration.properties))).toEqual([]);
  });

  test('names every chat tool by its name and its reference', () => {
    const tools: { name: string; toolReferenceName: string }[] =
      manifest.contributes.languageModelTools;
    expect(unnamed(tools.map((tool) => tool.name))).toEqual([]);
    expect(unnamed(tools.map((tool) => `#${tool.toolReferenceName}`))).toEqual([]);
  });
});
