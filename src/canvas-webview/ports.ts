// The ports the VS Code host supplies to the canvas page: the engine
// mapping's `source`, `editor`, `commands` and `context` over the bridge,
// `viewState` from what the host kept, and a `presenter` whose notices and
// confirmations are the host's dialogs; a notice keeps the failure document
// it carries. The editor's Generate tells the host what the package reads
// of the tree a Generate that succeeded wrote (`generatedTree`), which the
// host says and offers to show as Lace: Generate does. The object is built
// once per boot.
import {
  type BridgeEngineCaller,
  type CanvasPorts,
  type GenerateEvent,
  generatedTree,
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

// A Generate's events as they come, the host told what the package reads
// of the tree one that succeeded wrote.
async function* announced(
  events: AsyncIterable<GenerateEvent>,
  host: HostCaller,
): AsyncGenerator<GenerateEvent> {
  for await (const event of events) {
    if (event.type === 'success') host.notify({ op: 'generated', tree: generatedTree(event) });
    yield event;
  }
}

// Tells the host the working digest of each frame the page draws, which a
// Discard of what the page shows names.
export function forwardWorkingDigest(ports: CanvasPorts, host: HostCaller): () => void {
  let last: string | undefined;
  return ports.source.subscribe(
    (frame) => {
      if (frame.workingDigest === last) return;
      last = frame.workingDigest;
      host.notify({ op: 'digest', value: frame.workingDigest });
    },
    () => {},
  );
}
