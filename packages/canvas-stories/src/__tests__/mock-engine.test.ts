import type { CanvasView } from '@lace/proto';
import { describe, expect, it } from 'vitest';
import { MockCanvasEngine } from '../mocks/mock-engine';

const FIXTURE: CanvasView = {
  module_name: 'test',
  nodes: [
    {
      id: 'a',
      label: 'a',
      kind: 'module',
      position: { x: 0, y: 0 },
      has_errors: false,
      error_messages: [],
      inputs: [],
      outputs: [],
    },
  ],
  edges: [],
  errors: [],
  can_undo: false,
  can_redo: false,
  is_dirty: false,
  groups: [],
};

describe('MockCanvasEngine', () => {
  it('sessionOpen resolves with the fixture view', async () => {
    const engine = new MockCanvasEngine(FIXTURE);
    await expect(engine.sessionOpen()).resolves.toBe(FIXTURE);
  });

  it('emits a stateUpdated event with the fixture on subscribe', async () => {
    const engine = new MockCanvasEngine(FIXTURE);
    const events: unknown[] = [];
    engine.onEvent((e) => events.push(e));
    await new Promise((r) => queueMicrotask(r));
    expect(events).toEqual([{ type: 'stateUpdated', view: FIXTURE }]);
  });

  it('mutations return the current fixture unchanged', async () => {
    const engine = new MockCanvasEngine(FIXTURE);
    await expect(engine.connect()).resolves.toBe(FIXTURE);
    await expect(engine.deleteInstance()).resolves.toBe(FIXTURE);
    await expect(engine.createGroup()).resolves.toBe(FIXTURE);
    await expect(engine.undo()).resolves.toBe(FIXTURE);
  });

  it('sessionGenerate emits the progress → success sequence', async () => {
    const engine = new MockCanvasEngine(FIXTURE);
    const events: unknown[] = [];
    engine.onEvent((e) => events.push(e));
    // Drain the stateUpdated microtask first.
    await new Promise((r) => queueMicrotask(r));
    events.length = 0;

    await engine.sessionGenerate();

    expect(events).toEqual([
      { type: 'generateProgress', phase: 'generating' },
      { type: 'generateProgress', phase: 'formatting' },
      { type: 'generateSuccess', files: ['main.tf'] },
    ]);
  });

  it('unsubscribe stops further events from reaching the listener', async () => {
    const engine = new MockCanvasEngine(FIXTURE);
    const events: unknown[] = [];
    const unsubscribe = engine.onEvent((e) => events.push(e));
    await new Promise((r) => queueMicrotask(r));
    unsubscribe();

    await engine.sessionGenerate();
    expect(events).toHaveLength(1); // only the initial stateUpdated
  });
});
