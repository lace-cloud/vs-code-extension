// What the canvas page holds across one boot: the result store the mounted
// canvas reads and writes, and the ports it is handed, whose `context.stack`
// is the stack the host picked for the root. A pick replaces only the
// context: `source`, `editor`, `commands` and `presenter` stay the objects
// they were, so the canvas keeps its runner and every invocation it holds. A
// tick bumps the store, which re-reads what the canvas reads through it (the
// describe overlay's badges).
//
// The page listens from before it boots: the host answers `boot` with the
// pick as it stood then, and every later pick arrives as an event, so the
// last event heard, when there is one, is the current pick.
import {
  type CanvasPorts,
  createResultStore,
  type ResultStore,
  type StackRef,
} from '@lace-cloud/canvas/engine';
import type { HostCaller, PageEvent } from '../protocol/host-protocol';

export type CanvasPage = {
  readonly results: ResultStore;
  // Takes the ports the page booted with and the stack `boot` answered.
  mount: (booted: CanvasPorts, stack: StackRef | undefined) => void;
  // `listener` is called with the ports to mount the canvas with: once at
  // `mount`, then each time the stack changes.
  onDidChangePorts: (listener: (ports: CanvasPorts) => void) => () => void;
};

const withStack = (ports: CanvasPorts, stack: StackRef | undefined): CanvasPorts => ({
  ...ports,
  context: { ...ports.context, stack },
});

export function canvasPage(host: Pick<HostCaller, 'onEvent'>): CanvasPage {
  const results = createResultStore();
  const listeners = new Set<(ports: CanvasPorts) => void>();
  let booted: CanvasPorts | undefined;
  let heard: { stack: StackRef | undefined } | undefined;

  const show = (ports: CanvasPorts, stack: StackRef | undefined): void => {
    const shown = withStack(ports, stack);
    for (const listener of [...listeners]) listener(shown);
  };

  host.onEvent((event: PageEvent) => {
    if (event.op === 'tick') {
      results.bumpTick();
      return;
    }
    heard = { stack: event.value };
    if (booted) show(booted, event.value);
  });

  return {
    results,
    mount(ports, stack) {
      booted = ports;
      show(ports, heard ? heard.stack : stack);
    },
    onDidChangePorts(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type FocusTarget = {
  addEventListener: (type: 'focus' | 'blur', listener: () => void) => void;
  removeEventListener: (type: 'focus' | 'blur', listener: () => void) => void;
};

// Tells the host whether the page's window has focus: now, and each time
// that changes. The window's own `blur` fires wherever focus goes next — a
// text editor, the chat, the Explorer, another window.
export function reportFocus(
  target: FocusTarget,
  hasFocus: () => boolean,
  host: Pick<HostCaller, 'notify'>,
): () => void {
  const focus = () => host.notify({ op: 'focus', value: true });
  const blur = () => host.notify({ op: 'focus', value: false });
  target.addEventListener('focus', focus);
  target.addEventListener('blur', blur);
  host.notify({ op: 'focus', value: hasFocus() });
  return () => {
    target.removeEventListener('focus', focus);
    target.removeEventListener('blur', blur);
  };
}
