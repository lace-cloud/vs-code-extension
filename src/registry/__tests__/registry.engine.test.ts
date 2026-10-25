// The registry reads against the real engine, signed out: a developer home
// with no credentials, which the CLI answers from the public catalog.
import { describe, expect, test } from 'vitest';
import { realEngine } from '../../engine/__tests__/real-engine';
import { registryReads } from '../registry-reads';

describe('the registry sidebar on the real engine', () => {
  test('a list read with no credentials lists the public catalog’s modules', async () => {
    const { commands } = realEngine();
    const outcome = await registryReads(commands).list();
    if (outcome.kind !== 'result') throw new Error(`the list failed: ${outcome.failure.message}`);
    expect(outcome.document.items.length).toBeGreaterThan(0);
    for (const row of outcome.document.items) {
      expect(row).toMatchObject({ axis: 'module', visibility: 'public' });
    }
  });
});
