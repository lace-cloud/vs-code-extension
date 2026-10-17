// The ports the VS Code host supplies to the canvas page: the engine
// mapping's `source`, `editor`, `commands` and `context` over the bridge,
// `viewState` from what the host kept, and a `presenter` whose notices and
// confirmations are the host's dialogs; a notice keeps the failure document
// it carries. The editor's Generate tells the host what a Generate that
// succeeded reports of the tree it wrote, which the host says and offers to
// show as Lace: Generate does. The object is built once per boot.
import {
  type BridgeEngineCaller,
  type CanvasPorts,
  type GenerateEvent,
  openEngineSession,
} from '@lace-cloud/canvas/engine';
import type { Boot, HostCaller } from '../protocol/host-protocol';

export async function canvasPorts(
  caller: BridgeEngineCaller,
  host: HostCaller,
  boot: Boot,
): Promise<CanvasPorts> {
  const { ports } = await openEngineSession(caller, { root: boot.root });
  return {
    ...ports,
    editor: { ...ports.editor, generate: () => announced(ports.editor.generate(), host) },
    viewState: {
      load: () => boot.arrangement,
      save: (arrangement) => host.notify({ op: 'arrangement', value: arrangement }),
    },
    presenter: {
      notify: (level, text, failure) =>
        host.notify({ op: 'notify', level, text, ...(failure ? { failure } : {}) }),
      confirm: (spec) => host.call('confirm', spec),
    },
  };
}

// A Generate's events as they come, the host told the files one that
// succeeded wrote, changed and removed.
async function* announced(
  events: AsyncIterable<GenerateEvent>,
  host: HostCaller,
): AsyncGenerator<GenerateEvent> {
  for await (const event of events) {
    if (event.type === 'success') {
      const { written, changed, removed } = event;
      host.notify({ op: 'generated', files: { written, changed, removed } });
    }
    yield event;
  }
}

// Tells the host whether the session has unsaved edits, as each frame says.
export function forwardUnsaved(ports: CanvasPorts, host: HostCaller): () => void {
  let last: boolean | undefined;
  return ports.source.subscribe(
    (frame) => {
      if (frame.unsaved === last) return;
      last = frame.unsaved;
      host.notify({ op: 'unsaved', value: frame.unsaved });
    },
    () => {},
  );
}
