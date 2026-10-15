import type { BindingRuntime, HostBinding } from '@lace-cloud/canvas/engine';
import type { Diagnostic } from '@lace-cloud/proto';
import { describe, expect, test, vi } from 'vitest';
import type { HostCaller } from '../../protocol/host-protocol';
import { hostContributions } from '../contributions';

function fakeHost(): HostCaller {
  return {
    call: vi.fn(async () => null) as never,
    notify: vi.fn(),
    onEvent: () => () => {},
  };
}

// The Open source action the page contributes, and a runtime whose
// presenter records what it is told.
function openSource(host: HostCaller) {
  const [action] = hostContributions(host).actions;
  const notify = vi.fn();
  const rt = { ports: { presenter: { notify } } } as unknown as BindingRuntime;
  const run = (diagnostic: Diagnostic) =>
    (action.binding as HostBinding).run(rt, {}, { diagnostic });
  return { action, notify, run };
}

describe('Open source on a Diagnostics row', () => {
  test('is a host action on each row of the Diagnostics list, run on that row’s diagnostic', () => {
    const { action } = openSource(fakeHost());
    expect(action).toMatchObject({
      label: 'Open source',
      placement: { row: 'diagnostics' },
      requiredPorts: [],
      requiredTarget: ['diagnostic'],
      binding: { kind: 'host' },
    });
  });

  test('sends the host the file, line and column the diagnostic names', async () => {
    const host = fakeHost();
    const { run, notify } = openSource(host);
    await run({
      severity: 'error',
      message: 'not set',
      file: 'network/main.tf',
      line: 4,
      column: 2,
    });
    expect(host.call).toHaveBeenCalledWith('openSource', {
      file: 'network/main.tf',
      line: 4,
      column: 2,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  test('says so for a diagnostic that names no file, and sends nothing', async () => {
    const host = fakeHost();
    const { run, notify } = openSource(host);
    await run({
      severity: 'error',
      message: 'Required input "vpc_id" is not set',
      module_key: 'm',
      instance_id: 'vpc',
    });
    expect(host.call).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      'info',
      'Required input "vpc_id" is not set: it names no file, only its place on the canvas.',
    );
  });
});

describe('Import existing resources on the source-refused banner', () => {
  const importResources = (host: HostCaller) => {
    const action = hostContributions(host).actions.find(({ id }) => id === 'import-resources');
    if (!action) throw new Error('no Import existing resources action');
    return action;
  };

  test("is a host action on the banner's row while the tree is out of lace shape, after Convert's choice, needing no row datum", () => {
    expect(importResources(fakeHost())).toEqual({
      id: 'import-resources',
      label: 'Import existing resources',
      choice:
        "Import existing resources restructures it the same way and adds import blocks from a statefile you pick, so an empty stack's first apply adopts the resources that statefile records instead of creating them again.",
      placement: { row: 'source-refused' },
      requiredPorts: [],
      requiredContext: ['root', 'needsConversion'],
      binding: { kind: 'host', run: expect.any(Function) },
    });
  });

  test('asks the host to import existing resources into a stack of the panel’s root', async () => {
    const host = fakeHost();
    const rt = { ports: { presenter: { notify: vi.fn() } } } as unknown as BindingRuntime;
    await (importResources(host).binding as HostBinding).run(rt, {}, {});
    expect(host.call).toHaveBeenCalledWith('importResources', {});
  });
});
