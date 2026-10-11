import { describe, expect, test } from 'vitest';
import { mostRecentFirst, toggled } from '../registry-marks';

describe('registry marks', () => {
  test('a favourite toggles', () => {
    expect(toggled(['a/b'], 'c/d')).toEqual(['a/b', 'c/d']);
    expect(toggled(['a/b', 'c/d'], 'a/b')).toEqual(['c/d']);
  });

  test('recently used keeps the five latest, most recent first, each once', () => {
    expect(mostRecentFirst(['a', 'b', 'c', 'd', 'e'], 'c')).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(mostRecentFirst(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
  });
});
