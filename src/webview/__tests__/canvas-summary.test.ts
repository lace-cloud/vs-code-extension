import { test, expect, describe } from 'vitest';
import { formatCanvasState } from '../../chat/utils/canvas-summary';
import { makeCanvasView, makeNode, makeEdge } from './helpers';

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
});
