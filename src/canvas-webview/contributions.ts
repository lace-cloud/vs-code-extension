// What the VS Code host adds to the canvas: two actions.
//
// Open source, on each row of the Diagnostics list, sends the host the
// file, line and column the row's diagnostic names, and the host opens that
// file beside the canvas. A diagnostic that names no file (one located in
// the graph, such as a required input not set) is said to have none, and
// nothing is sent.
//
// Import existing resources, on the source-refused banner while the tree is
// out of lace shape, beside the package's Convert: the banner says what each
// choice does, and this one asks the host to run Import Existing Resources
// on the panel's root, a stack command the host draws.
import type { Contributions } from '@lace-cloud/canvas';
import type { ActionContribution } from '@lace-cloud/canvas/engine';
import type { HostCaller } from '../protocol/host-protocol';

export function hostContributions(host: Pick<HostCaller, 'call'>): Contributions {
  const openSource: ActionContribution = {
    id: 'open-source',
    label: 'Open source',
    placement: { row: 'diagnostics' },
    requiredPorts: [],
    requiredTarget: ['diagnostic'],
    binding: {
      kind: 'host',
      run: async (rt, _ctx, { diagnostic }) => {
        if (!diagnostic) return;
        const { file, line, column, message } = diagnostic;
        if (file === undefined) {
          rt.ports.presenter.notify(
            'info',
            `${message}: it names no file, only its place on the canvas.`,
          );
          return;
        }
        await host.call('openSource', {
          file,
          ...(line === undefined ? {} : { line }),
          ...(column === undefined ? {} : { column }),
        });
      },
    },
  };
  const importResources: ActionContribution = {
    id: 'import-resources',
    label: 'Import existing resources',
    choice:
      "Import existing resources restructures it the same way and adds import blocks from a statefile you pick, so an empty stack's first apply adopts the resources that statefile records instead of creating them again.",
    placement: { row: 'source-refused' },
    requiredPorts: [],
    requiredContext: ['root', 'needsConversion'],
    binding: {
      kind: 'host',
      run: async () => {
        await host.call('importResources', {});
      },
    },
  };
  return { overlays: [], panels: [], actions: [openSource, importResources] };
}
