import { describe, expect, test } from 'vitest';
import { detailMessageOf, moduleKey, sidebarMessageOf } from '../registry-protocol';

describe('the registry protocol', () => {
  test('a module is keyed by its author and name', () => {
    expect(moduleKey({ author: 'lace', name: 'vpc' })).toBe('lace/vpc');
  });

  test.each([
    [{ op: 'ready' }, { op: 'ready' }],
    [{ op: 'openPublishingGuide', url: 'https://evil' }, { op: 'openPublishingGuide' }],
    [
      { op: 'showDetail', key: 'lace/vpc' },
      { op: 'showDetail', key: 'lace/vpc' },
    ],
    [
      { op: 'place', key: 'lace/vpc', version: '1.2.0' },
      { op: 'place', key: 'lace/vpc', version: '1.2.0' },
    ],
    [{ op: 'place', key: 'lace/vpc' }, null],
    [{ op: 'versions', key: 3 }, null],
    [{ op: 'run', key: 'x' }, null],
    ['ready', null],
    [null, null],
  ])('a sidebar message %j reads as %j', (raw, parsed) => {
    expect(sidebarMessageOf(raw)).toEqual(parsed);
  });

  test.each([
    [{ op: 'ready' }, { op: 'ready' }],
    [
      { op: 'place', version: '1.0.0' },
      { op: 'place', version: '1.0.0' },
    ],
    [{ op: 'place' }, null],
    [{ op: 'refresh' }, null],
  ])('a detail message %j reads as %j', (raw, parsed) => {
    expect(detailMessageOf(raw)).toEqual(parsed);
  });
});
