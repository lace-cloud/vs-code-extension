import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import type { RootSources } from '../../roots/authoring-roots';
import { openCanvas } from '../open-canvas';

const repo = folder('/work/repo');

function setup(terraformFiles: readonly vscode.Uri[] = []) {
  const panels = { ensure: vi.fn(async () => ({}) as never) };
  const window = { showInformationMessage: vi.fn(async () => undefined) };
  const sources: RootSources = {
    folders: () => [repo],
    activeCanvas: () => undefined,
    activeTerraformDirectory: () => undefined,
    terraformFiles: async () => terraformFiles,
    pick: async () => undefined,
  };
  return { open: openCanvas(panels, sources, window), panels, window };
}

describe('Lace: Open Canvas', () => {
  test('opens the canvas of the folder pointed at', async () => {
    const { open, panels, window } = setup();
    await open(uri('/work/repo/infra/prod'));
    expect(panels.ensure).toHaveBeenCalledWith({ folder: repo, relative: 'infra/prod' });
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  test('a dismissed pick of a module opens nothing and says nothing', async () => {
    const { open, panels, window } = setup([
      uri('/work/repo/infra/prod/main.tf'),
      uri('/work/repo/infra/stage/main.tf'),
    ]);
    await open();
    expect(panels.ensure).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  test("a folder inside Terraform's cache opens nothing and is named for what it is", async () => {
    const { open, panels, window } = setup();
    await open(uri('/work/repo/infra/.terraform/modules/net'));
    expect(panels.ensure).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'No module to open: infra/.terraform/modules/net is inside .terraform, which is not a module directory.',
    );
  });
});
