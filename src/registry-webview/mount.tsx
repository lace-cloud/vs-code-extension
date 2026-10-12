// Mounts a registry page: it follows VS Code's theme, draws the state the
// host sends and tells the host it is ready, once, so the host sends the
// state it holds.
import { type ComponentType, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ToPage } from '../protocol/registry-protocol';
import { pagePort } from '../webview/page-port';
import { followTheme } from '../webview/theme';

const isState = <S,>(message: unknown): message is ToPage<S> =>
  typeof message === 'object' && message !== null && 'op' in message && message.op === 'state';

export function mountPage<S, M extends { op: string }>(
  Page: ComponentType<{ state: S; send: (message: M) => void }>,
  ready: M,
): void {
  followTheme(document);
  const element = document.getElementById('root');
  if (!element) throw new Error('the page has no #root');
  const port = pagePort();
  const send = (message: M) => port.post(message);

  function Root() {
    const [state, setState] = useState<S | null>(null);
    useEffect(() => {
      const off = port.onMessage((message) => {
        if (isState<S>(message)) setState(message.state);
      });
      send(ready);
      return off;
    }, []);
    return state === null ? null : <Page state={state} send={send} />;
  }

  createRoot(element).render(<Root />);
}
