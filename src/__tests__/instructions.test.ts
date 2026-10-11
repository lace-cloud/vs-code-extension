// The text-level instructions the extension contributes to the developer's
// coding assistant: what an assistant editing a Lace module's `.tf` files
// directly is told.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const [contribution] = manifest.contributes.chatInstructions;
const text = readFileSync(join(ROOT, contribution.path), 'utf8');

describe('the text-level instructions', () => {
  test('are the one file the manifest contributes, applied to Terraform files', () => {
    expect(manifest.contributes.chatInstructions).toHaveLength(1);
    expect(contribution.path).toMatch(/^\.\/resources\/instructions\/.+\.instructions\.md$/);
    expect(text).toMatch(/^---\n[\s\S]*applyTo: "\*\*\/\*\.tf"\n[\s\S]*---\n/);
  });

  test.each([
    ['Generate before a hand edit', 'Generate pending canvas edits before editing `.tf` by hand'],
    ['Lace style and its authority', 'in Lace style, and `lace module validate` says whether'],
    ['comments and layout', 'Generate does not keep comments or layout'],
    ['groups', 'A group on the canvas is a child module'],
    ['per-environment values', '`--var-file <file>` or `--var name=value`'],
    ['conflicts and refused tf', "is the developer's to resolve on the canvas"],
  ])('state the rule on %s', (_rule, wording) => {
    expect(text).toContain(wording);
  });

  // The file ships whether or not any chat tool does, so it names none: no
  // tool identifier and no `#` tool reference.
  test('name no tool', () => {
    expect(text).not.toMatch(/\blace_[a-z_]+/);
    expect(text).not.toMatch(/#[a-zA-Z]/);
    expect(text).not.toMatch(/\btools?\b/i);
  });
});
