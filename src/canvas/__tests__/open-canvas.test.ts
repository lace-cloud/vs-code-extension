import { describe, expect, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import type { AuthoringRoot, StartingSources } from '../../roots/authoring-roots';
import { openCanvas } from '../open-canvas';

const repo = folder('/work/repo');
const other = folder('/work/other', 1);

function setup(
  terraformFiles: readonly vscode.Uri[] = [],
  options: {
    folders?: vscode.WorkspaceFolder[];
    // The folder the developer starts the module in, by index; none when
    // they dismiss the pick.
    starts?: number;
  } = {},
) {
  const panels = { ensure: vi.fn(async () => ({}) as never) };
  const window = { showInformationMessage: vi.fn(async () => undefined) };
  const start = vi.fn(async (roots: readonly AuthoringRoot[]) =>
    options.starts === undefined ? undefined : roots[options.starts],
  );
  const sources: StartingSources = {
    folders: () => options.folders ?? [repo],
    activeCanvas: () => undefined,
    openCanvases: () => [],
    activeTerraformDirectory: () => undefined,
    terraformFiles: async () => terraformFiles,
    pick: async () => undefined,
    start,
  };
  return { open: openCanvas(panels, sources, window), panels, window, start };
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

describe('Lace: Open Canvas in a workspace that holds no Terraform', () => {
  test("opens the canvas of the workspace's folder, where the module starts, asking nothing and saying nothing", async () => {
    const { open, panels, window, start } = setup();
    await open();
    expect(panels.ensure).toHaveBeenCalledWith({ folder: repo, relative: '' });
    expect(start).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  test('of several folders, opens the canvas of the one the developer picks', async () => {
    const { open, panels, start } = setup([], { folders: [repo, other], starts: 1 });
    await open();
    expect(start).toHaveBeenCalledOnce();
    expect(panels.ensure).toHaveBeenCalledWith({ folder: other, relative: '' });
  });

  test('a dismissed pick of the folder opens nothing and says nothing', async () => {
    const { open, panels, window } = setup([], { folders: [repo, other] });
    await open();
    expect(panels.ensure).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  test('with no folder open, opens nothing and says to open one', async () => {
    const { open, panels, window } = setup([], { folders: [] });
    await open();
    expect(panels.ensure).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'No module to open: no folder is open. Open the folder that holds the module first.',
    );
  });
});
