// What the VS Code host adds to the canvas: one action, Open source, on
// each row of the Diagnostics list. It sends the host the file, line and
// column the row's diagnostic names, and the host opens that file beside
// the canvas. A diagnostic that names no file (one located in the graph,
// such as a required input not set) is said to have none, and nothing is
// sent.
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
  return { overlays: [], panels: [], actions: [openSource] };
}
