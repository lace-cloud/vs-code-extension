import { describe, expect, test } from 'vitest';
import { nameWithSlug, rowDescription, slugBeside } from '../slug-beside';

describe("a row's name with its slug", () => {
  test('is the name alone where the name is the slug', () => {
    expect(nameWithSlug({ name: 'prod', slug: 'prod' })).toBe('prod');
  });

  test('puts the slug in parentheses after the name where it differs', () => {
    expect(nameWithSlug({ name: 'Prod', slug: 'prod' })).toBe('Prod (prod)');
  });
});

describe("a row's slug beside its name", () => {
  test('is nothing where the name is the slug', () => {
    expect(slugBeside({ name: 'prod', slug: 'prod' })).toEqual([]);
  });

  test('is the slug where it differs from the name', () => {
    expect(slugBeside({ name: 'Production', slug: 'prod' })).toEqual(['prod']);
  });

  test('is the slug where the name differs only in case, since the rule is equality', () => {
    expect(slugBeside({ name: 'Prod', slug: 'prod' })).toEqual(['prod']);
  });
});

describe("a row's description", () => {
  const named = { name: 'prod', slug: 'prod' };
  const differing = { name: 'Prod', slug: 'prod' };

  test('is empty for a name that is its slug with no markers', () => {
    expect(rowDescription(named, [])).toBe('');
  });

  test('names the slug where it differs, then each marker in order, on one line', () => {
    expect(rowDescription(differing, [])).toBe('prod');
    expect(rowDescription(differing, ['current', 'owner'])).toBe('prod · current · owner');
  });

  test('is the markers alone where the name is its slug', () => {
    expect(rowDescription(named, ['on the canvas', 'drift drifted (1)'])).toBe(
      'on the canvas · drift drifted (1)',
    );
  });

  test('leaves an empty marker out, so no separator stands beside it', () => {
    expect(rowDescription(differing, ['', 'owner'])).toBe('prod · owner');
    expect(rowDescription(named, ['', ''])).toBe('');
  });
});
