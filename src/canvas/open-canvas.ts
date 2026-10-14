// Lace: Open Canvas, from the palette and the Explorer's folder menu: the
// canvas of the root the developer pointed at, or of the one `nameRoot`
// finds, which in a workspace that holds no module is the workspace folder
// the module starts in; with none, what `rootToAct` tells the developer.
import type * as vscode from 'vscode';
import { rootToAct, type StartingSources } from '../roots/authoring-roots';
import type { CanvasPanels } from './canvas-panels';

export const OPEN_CANVAS = 'lace.openCanvas';

export function openCanvas(
  panels: Pick<CanvasPanels, 'ensure'>,
  sources: StartingSources,
  window: Pick<typeof vscode.window, 'showInformationMessage'>,
): (pointedAt?: vscode.Uri) => Promise<void> {
  return async (pointedAt) => {
    const root = await rootToAct(sources, window, 'open', pointedAt);
    if (root) await panels.ensure(root);
  };
}
