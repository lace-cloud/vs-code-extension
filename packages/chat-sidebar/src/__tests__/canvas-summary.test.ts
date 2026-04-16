import { describe, expect, test } from 'vitest';
import { formatCanvasState } from '../host/utils/canvas-summary';
import { makeCanvasView, makeEdge, makeNode } from './helpers';

describe('formatCanvasState', () => {
  test('undefined view returns "no canvas" message', () => {
    const result = formatCanvasState(undefined);
    expect(result).toContain('No canvas is open');
  });

  test('empty view returns "empty" message', () => {
    const result = formatCanvasState(makeCanvasView());
    expect(result).toContain('empty');
  });

  test('compact mode: one-line lists', () => {
    const view = makeCanvasView(
      [makeNode('vpc'), makeNode('subnet')],
      [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')],
    );
    const result = formatCanvasState(view, { compact: true });
    expect(result).toContain('2 instance(s)');
    expect(result).toContain('1 connection(s)');
    expect(result).toContain('vpc');
    expect(result).toContain('subnet');
  });

  test('detailed mode: markdown headers', () => {
    const view = makeCanvasView(
      [makeNode('vpc'), makeNode('subnet')],
      [makeEdge('vpc', 'subnet', 'vpc_id', 'vpc_id')],
    );
    const result = formatCanvasState(view);
    expect(result).toContain('### Instances');
    expect(result).toContain('### Connections');
    expect(result).toContain('**vpc**');
  });

  test('compact mode includes groups', () => {
    const view = makeCanvasView([makeNode('vpc'), makeNode('subnet'), makeNode('ec2')], []);
    view.groups = [{ id: 'g1', label: 'Network', node_ids: ['vpc', 'subnet'], collapsed: false }];
    const result = formatCanvasState(view, { compact: true });
    expect(result).toContain('1 group(s)');
    expect(result).toContain('Network [vpc, subnet]');
  });

  test('compact mode shows collapsed state', () => {
    const view = makeCanvasView([makeNode('vpc'), makeNode('subnet')], []);
    view.groups = [{ id: 'g1', label: 'Network', node_ids: ['vpc', 'subnet'], collapsed: true }];
    const result = formatCanvasState(view, { compact: true });
    expect(result).toContain('(collapsed)');
  });

  test('detailed mode includes groups section', () => {
    const view = makeCanvasView([makeNode('vpc'), makeNode('subnet')], []);
    view.groups = [{ id: 'g1', label: 'Network', node_ids: ['vpc', 'subnet'], collapsed: false }];
    const result = formatCanvasState(view);
    expect(result).toContain('### Groups');
    expect(result).toContain('**Network**');
    expect(result).toContain('vpc, subnet');
  });

  test('no groups section when groups is empty', () => {
    const view = makeCanvasView([makeNode('vpc')], []);
    const result = formatCanvasState(view, { compact: true });
    expect(result).not.toContain('group');
    expect(result).not.toContain('Groups');
  });
});
