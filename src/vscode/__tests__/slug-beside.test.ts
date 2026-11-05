import { describe, expect, test } from 'vitest';
import { nameWithSlug, rowDescription } from '../slug-beside';

describe("a row's name with its slug", () => {
  test('is the name alone where the name is the slug', () => {
    expect(nameWithSlug({ name: 'prod', slug: 'prod' })).toBe('prod');
  });

  test('puts the slug in parentheses after the name where it differs', () => {
    expect(nameWithSlug({ name: 'Prod', slug: 'prod' })).toBe('Prod (prod)');
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

  test('names the slug where it differs from the name, though only in case: the rule is equality', () => {
    expect(rowDescription({ name: 'Production', slug: 'prod' }, [])).toBe('prod');
    expect(rowDescription(differing, [])).toBe('prod');
  });

  test('is the markers alone where the name is its slug', () => {
    expect(rowDescription(named, ['on the canvas', 'drift drifted (1)'])).toBe(
      'on the canvas · drift drifted (1)',
    );
  });
});
