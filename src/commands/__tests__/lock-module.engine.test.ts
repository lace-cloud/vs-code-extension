// Lock Providers against the real engine, with no canvas open: `module lock`
// writes the root's lockfile beside its Terraform, and the notice names it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { moduleDirectory } from '../../engine/__tests__/real-engine';
import { LOCK_MODULE } from '../authoring-commands';
import { window } from './engine-window';

const MODULE = 'variable "name" {\n  type = string\n}\n';

describe('Lock Providers on the real engine', () => {
  test('writes the lockfile beside the module, says what the package says of the lock, and rewrites no Terraform', async () => {
    const { repository, root } = moduleDirectory({ 'main.tf': MODULE });
    const { table, api } = window(repository);

    await table[LOCK_MODULE]();
    expect(api.window.showErrorMessage).not.toHaveBeenCalled();
    expect(api.window.showInformationMessage).toHaveBeenCalledWith(
      'infra: Locked 0 providers in .terraform.lock.hcl. Commit it beside the tree.',
    );
    expect(existsSync(join(root, '.terraform.lock.hcl'))).toBe(true);
    expect(readFileSync(join(root, 'main.tf'), 'utf8')).toBe(MODULE);
  });
});
