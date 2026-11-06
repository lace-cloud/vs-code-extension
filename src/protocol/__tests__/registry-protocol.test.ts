import { describe, expect, test } from 'vitest';
import {
  DEPRECATED,
  detailMessageOf,
  isDeprecated,
  moduleKey,
  newestPublishedNote,
  sidebarMessageOf,
  statusOf,
  versionTitle,
} from '../registry-protocol';
import { versionEntry } from './registry-fixtures';

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
    [
      { op: 'place', key: 'lace/vpc', version: '1.2.0', status: 'published' },
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
    [
      { op: 'place', version: '1.0.0', status: 'published' },
      { op: 'place', version: '1.0.0' },
    ],
    [{ op: 'place' }, null],
    [{ op: 'refresh' }, null],
  ])('a detail message %j reads as %j', (raw, parsed) => {
    expect(detailMessageOf(raw)).toEqual(parsed);
  });

  test('the word is Deprecated', () => {
    expect(DEPRECATED).toBe('Deprecated');
  });

  test.each([
    ['deprecated', true],
    ['published', false],
    ['', false],
    ['yanked', false],
    ['Deprecated', false],
    ['deprecated-soon', false],
  ])('the status %j is deprecated: %s', (status, deprecated) => {
    expect(isDeprecated(status)).toBe(deprecated);
  });

  test.each([
    ['published', 'v0.5.0 is the newest published version'],
    ['deprecated', undefined],
    ['', undefined],
    ['yanked', undefined],
    ['Published', undefined],
    ['published-soon', undefined],
  ])('the note of a latest version with status %j is %j', (status, note) => {
    expect(newestPublishedNote({ version: 'v0.5.0', status }, 'v0.4.0')).toBe(note);
  });

  test('the note is none for a latest that is the version itself, or for no latest', () => {
    expect(newestPublishedNote({ version: 'v0.4.0', status: 'published' }, 'v0.4.0')).toBe(
      undefined,
    );
    expect(newestPublishedNote(undefined, 'v0.4.0')).toBe(undefined);
  });

  test.each([
    ['v0.4.0', 'deprecated', 'v0.4.0 (Deprecated)'],
    ['v0.3.0', 'published', 'v0.3.0'],
    ['v0.3.0', '', 'v0.3.0'],
    ['v0.3.0', 'yanked', 'v0.3.0'],
  ])('the title of %s with status %j is %j', (version, status, title) => {
    expect(versionTitle(version, status)).toBe(title);
  });

  describe('the status of a version of a row', () => {
    const listed = [versionEntry('v1.5.0', 'published'), versionEntry('v1.0.0', 'deprecated')];
    const deprecated = { version: 'v2.0.0', status: 'deprecated' };

    test.each([
      ['the version the row lists, whatever is listed', deprecated, listed, 'v2.0.0', 'deprecated'],
      [
        'the version the row lists, listed with another status',
        { ...deprecated, status: 'published' },
        [versionEntry('v2.0.0', 'deprecated')],
        'v2.0.0',
        'published',
      ],
      ['a listed published version', deprecated, listed, 'v1.5.0', 'published'],
      [
        'a listed deprecated version',
        { ...deprecated, status: 'published' },
        listed,
        'v1.0.0',
        'deprecated',
      ],
      ['a version nothing lists', deprecated, listed, 'v9.9.9', ''],
      ['a version with no versions listed', deprecated, undefined, 'v1.0.0', ''],
    ])('is that of %s', (_case, rowOf, versions, version, status) => {
      expect(statusOf(rowOf, versions, version)).toBe(status);
    });
  });
});
