const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
exports.activate = async () => {
  const dir = process.env.LACE_HOT_TEST_DIR,
    root = path.join(dir, 'workspace', 'module');
  function write(name, value) {
    fs.writeFileSync(path.join(dir, name), value);
  }
  try {
    const ext = vscode.extensions.getExtension('LaceCloudInc.lace-cloud');
    if (!ext) throw Error('extension missing');
    const api = await ext.activate();
    if (process.env.LACE_HOT_PHASE === '1') {
      const hold = await api.rootSessions.acquire(root);
      let frame;
      hold.ports.source.subscribe(
        (f) => {
          frame = f;
        },
        () => {},
      );
      const result = await hold.ports.editor.apply([
        { set_variables: { scope: frame.bundle.entry, variables: [] } },
      ]);
      if (!result.success) throw Error(`apply failed ${JSON.stringify(result)}`);
      const until = Date.now() + 15000;
      const storage = path.join(
        dir,
        'profile',
        'User',
        'globalStorage',
        'lacecloudinc.lace-cloud',
        'recovery',
      );
      let found = false;
      while (Date.now() < until) {
        if (
          fs.existsSync(storage) &&
          fs
            .readdirSync(storage, { recursive: true })
            .some((x) => /^[a-f0-9-]{36}$/.test(path.basename(x)))
        ) {
          found = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!found) throw Error(`recovery marker missing at ${storage}`);
      write('expected.json', JSON.stringify(frame.bundle));
      write('ready', 'ready');
      if (process.env.LACE_HOT_GRACEFUL)
        await vscode.commands.executeCommand('workbench.action.quit');
      await new Promise(() => {});
    } else {
      write('phase2-start', 'ready');
      const hold = await api.rootSessions.acquire(root);
      let frame;
      hold.ports.source.subscribe(
        (f) => {
          frame = f;
        },
        () => {},
      )();
      const expected = fs.readFileSync(path.join(dir, 'expected.json'), 'utf8');
      if (!frame.unsaved || JSON.stringify(frame.bundle) !== expected)
        throw Error('restored frame differs');
      write('PASS', 'restored');
      await hold.release();
    }
  } catch (e) {
    write(`error-${process.env.LACE_HOT_PHASE}`, String(e.stack || e));
    throw e;
  }
};
