// Lace: Open Canvas, from the palette and the Explorer's folder menu: the
// canvas of the root the developer pointed at, or of the one `nameRoot`
// finds; with none, what `rootToAct` tells the developer.
import type * as vscode from 'vscode';
import { type RootSources, rootToAct } from '../roots/authoring-roots';
import type { CanvasPanels } from './canvas-panels';

export const OPEN_CANVAS = 'lace.openCanvas';

export function openCanvas(
  panels: Pick<CanvasPanels, 'ensure'>,
  sources: RootSources,
  window: Pick<typeof vscode.window, 'showInformationMessage'>,
): (pointedAt?: vscode.Uri) => Promise<void> {
  return async (pointedAt) => {
    const root = await rootToAct(sources, window, 'open', pointedAt);
    if (root) await panels.ensure(root);
  };
}
