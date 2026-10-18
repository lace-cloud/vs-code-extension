// The module commands against the real engine, with no canvas open.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { moduleDirectory, moduleIn, scratchDirectory } from '../../engine/__tests__/real-engine';
import { shownBy } from '../../vscode/__tests__/fake-messages';
import {
  CONVERT_MODULE,
  FORMAT_MODULE,
  GENERATE_DOCS,
  SCAN_MODULE,
  VALIDATE_MODULE,
} from '../authoring-commands';
import { window } from './engine-window';

const UNFORMATTED = 'variable "name" {\ntype = string\n}\n';
// A module in Lace style that Terraform refuses: its output calls a function
// Terraform does not have, which Lace's own rules do not read.
const BROKEN =
  'variable "name" {\n  type = string\n}\n\noutput "x" {\n  value = nofunc(var.name)\n}\n';
// A module Lace's own rules refuse: its output reads a local value it does
// not declare. Its validate stops short of a verdict, with Lace's
// diagnostic and Terraform's.
const UNDECLARED =
  'variable "name" {\n  type = string\n}\n\noutput "x" {\n  value = local.missing\n}\n';
// A module written by hand: a resource at its root, which Lace style
// composes into a child module of its own.
const HAND_WRITTEN = [
  'variable "name" {',
  '  type = string',
  '}',
  '',
  'resource "terraform_data" "label" {',
  '  input = var.name',
  '}',
  '',
  'output "label" {',
  '  value = terraform_data.label.output',
  '}',
  '',
].join('\n');

// A module whose `check` block Lace style cannot carry.
const CHECKED =
  'check "always" {\n  assert {\n    condition     = true\n    error_message = "never"\n  }\n}\n';

const filesIn = (root: string): string[] =>
  readdirSync(root, { recursive: true, encoding: 'utf8' }).sort();

describe('the module commands on the real engine, with no canvas open', () => {
  test('Validate, Format, Scan and Generate Docs create no canvas state and write no README', async () => {
    const { repository, root } = moduleDirectory({ 'main.tf': UNFORMATTED });
    const { table } = window(repository);

    for (const id of [VALIDATE_MODULE, FORMAT_MODULE, SCAN_MODULE, GENERATE_DOCS]) {
      await table[id]();
    }
    expect(existsSync(join(root, '.lace', '.canvas'))).toBe(false);
    expect(filesIn(root).filter((file) => !file.startsWith('.lace'))).toEqual(['main.tf']);
  });

  test('Validate reports its verdict and its diagnostics as the result of the command', async () => {
    const { repository } = moduleDirectory({ 'main.tf': BROKEN });
    const { table, api } = window(repository);

    await table[VALIDATE_MODULE]();
    expect(api.window.showWarningMessage).toHaveBeenCalledWith(
      'Validated infra: already-lace-style, 1 diagnostic.',
      'Show Report',
    );
  });

  test('Validate of a module Lace’s rules refuse reports its diagnostics, and names no verdict', async () => {
    const { repository } = moduleDirectory({ 'main.tf': UNDECLARED });
    const { table, api } = window(repository);

    await table[VALIDATE_MODULE]();
    expect(api.window.showWarningMessage).toHaveBeenCalledWith(
      'Validated infra, 2 diagnostics.',
      'Show Report',
    );
    expect(api.window.showErrorMessage).not.toHaveBeenCalled();
  });

  test('Format writes the files it names', async () => {
    const { repository, root } = moduleDirectory({ 'main.tf': UNFORMATTED });
    const { table, api } = window(repository);

    await table[FORMAT_MODULE]();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'Formatted 1 file in infra: main.tf.',
    );
    expect(readFileSync(join(root, 'main.tf'), 'utf8')).toBe(
      'variable "name" {\n  type = string\n}\n',
    );
  });

  test('Convert rewrites a hand-written module into Lace style in place, and says what it wrote', async () => {
    const { repository, root } = moduleDirectory({ 'main.tf': HAND_WRITTEN });
    const { table, api } = window(repository);

    await table[CONVERT_MODULE]();
    expect(api.window.showErrorMessage).not.toHaveBeenCalled();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'Converted infra: wrote main.tf, outputs.tf, terraform_data_label/main.tf, terraform_data_label/outputs.tf, terraform_data_label/variables.tf, variables.tf; locked 0 providers in .terraform.lock.hcl; already-lace-style, 0 diagnostics.',
      'Show Report',
    );
    expect(readFileSync(join(root, 'main.tf'), 'utf8')).toContain(
      'source = "./terraform_data_label"',
    );
    expect(readFileSync(join(root, 'terraform_data_label', 'main.tf'), 'utf8')).toContain(
      'resource "terraform_data" "label"',
    );
    expect(existsSync(join(root, '.lace', '.canvas'))).toBe(false);
  });

  test('Convert of a root outside a git repository says so, from its failure document, and writes nothing', async () => {
    const directory = scratchDirectory();
    const root = moduleIn(directory, 'infra', { 'main.tf': HAND_WRITTEN });
    const { table, api } = window(directory);

    await table[CONVERT_MODULE]();
    expect(api.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('requires a git repository; run `git init`'),
    );
    expect(filesIn(root)).toEqual(['main.tf']);
  });

  test('Convert of Terraform it cannot represent says so and offers Validate', async () => {
    const { repository, root } = moduleDirectory({ 'main.tf': CHECKED });
    const { table, api } = window(repository);

    await table[CONVERT_MODULE]();
    expect(shownBy(api.window.showErrorMessage)).toEqual([
      [
        '1 Terraform construct(s) Lace cannot carry; the report names each with what to change',
        'Validate',
      ],
    ]);
    expect(readFileSync(join(root, 'main.tf'), 'utf8')).toBe(CHECKED);
  });

  test('Generate Docs either opens the docs or names terraform-docs, which it is missing, with where to get it', async () => {
    const { repository } = moduleDirectory({ 'main.tf': UNFORMATTED });
    const { table, api } = window(repository);

    await table[GENERATE_DOCS]();
    const missing = shownBy(api.window.showErrorMessage);
    if (missing.length > 0) {
      expect(missing).toEqual([[expect.stringContaining('terraform-docs'), 'Install']]);
    } else {
      expect(api.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'markdown' }),
      );
    }
  });
});
