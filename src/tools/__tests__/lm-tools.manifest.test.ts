// The manifest's `languageModelTools` entries are generated from the tool
// sets' schemas, never written by hand: this test holds `package.json` to
// what `manifestEntries` makes of chat-core's `canvasToolSchemas` and
// `moduleToolSchemas`, and `pnpm manifest:tools` runs it with
// LACE_WRITE_MANIFEST=1 to write them there first.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { manifestEntries, TOOL_SCHEMAS } from '../lm-tools';

const MANIFEST = join(resolve(__dirname, '..', '..', '..'), 'package.json');

const generated = manifestEntries(TOOL_SCHEMAS);

if (process.env.LACE_WRITE_MANIFEST === '1') {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  manifest.contributes.languageModelTools = generated;
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const entries = manifest.contributes.languageModelTools;

describe("the manifest's tool entries", () => {
  test('are the ones the tool set generates', () => {
    expect(entries).toEqual(generated);
  });

  test('each has a name and a reference name, both unique', () => {
    const names = entries.map((entry: { name: string }) => entry.name);
    const references = entries.map(
      (entry: { toolReferenceName: string }) => entry.toolReferenceName,
    );
    for (const entry of entries) {
      expect(entry.name).toMatch(/^lace_[a-z_]+$/);
      expect(entry.toolReferenceName).toMatch(/^lace[A-Z][A-Za-z]+$/);
      expect(entry.canBeReferencedInPrompt).toBe(true);
    }
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(references).size).toBe(references.length);
    expect(references).toContain('laceChangeModuleCanvas');
  });

  test('every tool takes the root it is for, and none has a `when` clause', () => {
    for (const entry of entries) {
      expect(entry.inputSchema.required).toContain('root');
      expect(entry.inputSchema.properties.root.type).toBe('string');
      expect(entry).not.toHaveProperty('when');
    }
  });

  test("the change tool's schema is chat-core's, with the root beside its changes", () => {
    const change = entries.find(
      (entry: { name: string }) => entry.name === 'lace_change_module_canvas',
    );
    expect(Object.keys(change.inputSchema.properties)).toEqual(['root', 'changes']);
    expect(change.inputSchema.required).toEqual(['root', 'changes']);
    expect(change.inputSchema.additionalProperties).toBe(false);
  });
});
