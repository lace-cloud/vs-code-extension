// An extension host stand-in for the test that kills one: it starts the
// engine as the extension does, through `ServerManager`, holds a session on
// the root it is given, says which process the engine is, and then stays
// alive until something ends it.
//
//   node host-stand-in.mjs <engine binary> <root>
import { bridgeCaller, openEngineSession } from '@lace-cloud/canvas/engine';
import { ServerManager, serveEngineBridge } from '@lace-cloud/host';
import { childProcesses } from './os-processes.mjs';

const [binary, root] = process.argv.slice(2);

const manager = new ServerManager({
  log: () => {},
  getBinaryPath: () => binary,
  getAutoRestart: () => false,
});
await manager.start();

const toHost = new Set();
const toCaller = new Set();
const deliver = (listeners) => (frame) => {
  for (const listener of [...listeners]) listener(frame);
};
const listen = (listeners) => (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
serveEngineBridge({ post: deliver(toCaller), onMessage: listen(toHost) }, manager.transport);
const caller = bridgeCaller({ post: deliver(toHost), onMessage: listen(toCaller) });

const session = await openEngineSession(caller, { root });
const [engine] = childProcesses(process.pid).filter(({ command }) => command.includes(binary));
process.stdout.write(
  `${JSON.stringify({ enginePid: engine.pid, sessionId: session.ports.context.sessionId })}\n`,
);
setInterval(() => {}, 1000);
