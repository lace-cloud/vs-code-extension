// The palette's module commands against the real engine. With no canvas
// open they take no session and create no canvas state; Validate's report
// reaches Problems only through a held session; Generate writes saved edits
// with no tab; Convert rewrites a hand-written module in place.
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import {
  COMPOSED,
  canvasTabs,
  closeCanvas,
  heldSession,
  moduleDirectory,
  openCanvas,
  setName,
  settle,
  until,
} from './lace';

// A module whose `check` block Lace style cannot carry: a residual
// diagnostic at line 1 of main.tf.
const CHECKED = {
  'main.tf':
    'check "always" {\n  assert {\n    condition     = true\n    error_message = "never"\n  }\n}\n',
};

const HAND_WRITTEN = {
  'main.tf':
    'variable "name" {\n  type = string\n}\n\nresource "terraform_data" "label" {\n  input = var.name\n}\n\noutput "label" {\n  value = terraform_data.label.output\n}\n',
};

const problemsOf = (file: string): vscode.Diagnostic[] =>
  vscode.languages.getDiagnostics(vscode.Uri.file(file));

describe('the palette’s module commands', () => {
  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('Validate on a root with no canvas open creates no canvas state and puts nothing in Problems', async () => {
    const module = moduleDirectory(CHECKED);
    await settle('lace.validateModule', module.uri);
    assert.equal(existsSync(module.file('.lace/.canvas')), false);
    assert.deepEqual(problemsOf(module.file('main.tf')), []);
    assert.equal(await heldSession(module), undefined);
  });

  it('Validate with the canvas open puts its report in Problems, at the line', async () => {
    const module = moduleDirectory(CHECKED);
    await openCanvas(module);
    await settle('lace.validateModule', module.uri);
    await until(
      'the report to reach Problems',
      () => problemsOf(module.file('main.tf')).length > 0,
    );
    assert.equal(problemsOf(module.file('main.tf'))[0].range.start.line, 0);
  });

  it('Generate with saved edits and no canvas tab writes the Terraform and opens no tab', async () => {
    const module = moduleDirectory(COMPOSED);
    await openCanvas(module);
    await setName(module, 'generated');
    await settle('lace.save', module.uri);
    await closeCanvas(module);
    await until('the session to end', async () => (await heldSession(module)) === undefined);

    await settle('lace.generate', module.uri);
    assert.match(readFileSync(module.file('main.tf'), 'utf8'), /name\s*=\s*"generated"/);
    assert.deepEqual(canvasTabs(module), []);
  });

  it('Convert rewrites a hand-written module into Lace style in place, with no tab and no canvas state', async () => {
    const module = moduleDirectory(HAND_WRITTEN);
    await settle('lace.convertModule', module.uri);
    assert.match(
      readFileSync(module.file('main.tf'), 'utf8'),
      /source = "\.\/terraform_data_label"/,
    );
    assert.ok(existsSync(module.file('terraform_data_label/main.tf')));
    assert.equal(existsSync(module.file('.lace/.canvas')), false);
    assert.deepEqual(canvasTabs(module), []);
  });
});
