// The canvas page: boots over the host protocol, opens its root's session
// over the engine bridge, and mounts the canvas with the result store it
// owns, the stack the host picked and the host's contributions, mounting
// again when the pick changes.
import { App, ErrorState } from '@lace-cloud/canvas';
import { bridgeCaller } from '@lace-cloud/canvas/engine';
import { createRoot } from 'react-dom/client';
import { hostCaller, splitChannel } from '../protocol/host-protocol';
import { pagePort } from '../webview/page-port';
import { hostContributions } from './contributions';
import { canvasPage, reportFocus } from './page';
import { canvasPorts, forwardUnsaved } from './ports';
import '@lace-cloud/design-tokens/tokens.css';
import './entry.css';

async function boot(): Promise<void> {
  const element = document.getElementById('root');
  if (!element) throw new Error('the page has no #root');
  const root = createRoot(element);
  try {
    const { engine, host: hostPort } = splitChannel(pagePort());
    const host = hostCaller(hostPort);
    const page = canvasPage(host);
    const contributions = hostContributions(host);
    page.onDidChangePorts((ports) =>
      root.render(
        <App ports={ports} results={page.results} contributions={contributions} embedded />,
      ),
    );
    const booted = await host.call('boot', {});
    const ports = await canvasPorts(bridgeCaller(engine), host, booted);
    forwardUnsaved(ports, host);
    page.mount(ports, booted.stack);
    reportFocus(window, () => document.hasFocus(), host);
  } catch (error) {
    root.render(<ErrorState message={error instanceof Error ? error.message : String(error)} />);
  }
}

void boot();
