// The registry reads against the real engine, signed out: a developer home
// with no credentials.
import { describe, expect, test } from 'vitest';
import { realEngine, signedOutHome } from '../../engine/__tests__/real-engine';
import { registryReads } from '../registry-reads';

describe('the registry sidebar on the real engine', () => {
  test('a list read with no credentials fails with the reason the signed-out state is drawn by', async () => {
    const home = signedOutHome();
    const { commands } = realEngine({ home });
    const outcome = await registryReads(commands).list();
    expect(outcome).toMatchObject({ kind: 'failure', failure: { reason: 'unauthenticated' } });
  });
});
