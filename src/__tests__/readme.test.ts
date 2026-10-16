// The README is the extension's Marketplace page: it names every command,
// setting and chat tool the manifest contributes, so a contribution cannot
// ship without the page saying what it is, and the engine protocol and CLI
// release the extension speaks, so neither moves without the page. AGENTS.md,
// the map of the code, names the engine protocol too, so the protocol does
// not move without it either.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_PROTOCOL_VERSION } from '@lace-cloud/proto';
import { describe, expect, test } from 'vitest';
import { pinnedVersion } from '../engine/__tests__/engine-binary.mjs';

const ROOT = resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');

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

  // A Settings row is `| \`id\` | default | what it does |`, and its default
  // cell opens with the value the manifest contributes, in backticks.
  test("says every setting's contributed default in the Settings table", () => {
    const rows = new Map(
      [...readme.matchAll(/^\|\s*`([\w.]+)`\s*\|\s*([^|]*?)\s*\|/gm)].map(([, id, cell]) => [
        id,
        cell,
      ]),
    );
    const properties: Record<string, { default: unknown }> =
      manifest.contributes.configuration.properties;
    const said = Object.keys(properties).map((id) => [id, rows.get(id)?.split(' ')[0]]);
    expect(said).toEqual(
      Object.entries(properties).map(([id, p]) => [id, `\`${String(p.default)}\``]),
    );
  });

  test('names every chat tool by its name and its reference', () => {
    const tools: { name: string; toolReferenceName: string }[] =
      manifest.contributes.languageModelTools;
    expect(unnamed(tools.map((tool) => tool.name))).toEqual([]);
    expect(unnamed(tools.map((tool) => `#${tool.toolReferenceName}`))).toEqual([]);
  });

  test('names the engine protocol @lace-cloud/proto speaks and the CLI release LACE_CLI_VERSION pins', () => {
    const said = readme
      .replace(/\s+/g, ' ')
      .match(/engine protocol (\d+), which Lace CLI (v\S+) speaks/);
    expect(said?.slice(1)).toEqual([ENGINE_PROTOCOL_VERSION, pinnedVersion(ROOT)]);
  });
});

describe('AGENTS.md', () => {
  test('names the engine protocol @lace-cloud/proto speaks', () => {
    const said = agents
      .replace(/\s+/g, ' ')
      .match(/speaks engine protocol (\d+) \(`@lace-cloud\/proto`'s `ENGINE_PROTOCOL_VERSION`\)/);
    expect(said?.[1]).toBe(ENGINE_PROTOCOL_VERSION);
  });
});
