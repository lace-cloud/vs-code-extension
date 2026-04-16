/**
 * Seed-drift canary — Plan 2 Phase F.
 *
 * Runs BEFORE the golden-path screenshot tests. If lace-cli regenerates a
 * `.lace` seed with different bytes (schema bump, non-determinism bug, new
 * optional field), the committed `.sha256` canaries in lace-cli shift. This
 * canary compares those live canaries to the frozen mirror in
 * `__snapshots__/seed-manifest.json`.
 *
 * Why a separate canary rather than letting screenshots fail?
 *   Without it, upstream seed drift would manifest as 5 unexplained
 *   pixel diffs on the golden-path tests. With it, the PR author sees
 *   "seed-manifest: iam-stack hash mismatch (expected 52c145…, got a3b9c2…)"
 *   first — a clear signal that upstream changed, not a visual regression.
 *
 * When seeds change upstream, update both in the same PR:
 *   1. `tests/flow/__snapshots__/seed-manifest.json` — new hashes
 *   2. `tests/flow/__snapshots__/*.png` — regenerated baselines (via
 *      `pnpm flow-tests:update` in the pinned Playwright container)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';

// Resolve the lace-cli checkout. Locally devs keep it as a sibling at
// ../lace-cli. CI workflows set $LACE_CLI_REPO explicitly.
function resolveLaceCliRepo(): string {
  if (process.env.LACE_CLI_REPO) return process.env.LACE_CLI_REPO;
  const gha = process.env.GITHUB_WORKSPACE;
  if (gha) return path.resolve(gha, '..', 'lace-cli');
  return path.resolve(__dirname, '..', '..', '..', 'lace-cli');
}

const SEEDS_DIR = 'internal/module/server/testdata/seeds';

type Manifest = {
  description: string;
  source: string;
  generated_at: string;
  fixtures: Record<string, string>;
};

test.describe('seed-drift canary', () => {
  test('lace-cli .sha256 canaries match committed manifest', async () => {
    const repoRoot = resolveLaceCliRepo();
    const seedsPath = path.join(repoRoot, SEEDS_DIR);
    expect(
      fs.existsSync(seedsPath),
      `lace-cli seeds not found at ${seedsPath}. Set $LACE_CLI_REPO to the lace-cli checkout path.`,
    ).toBe(true);

    const manifestPath = path.resolve(__dirname, '__snapshots__', 'seed-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;

    const mismatches: string[] = [];
    const missingOnDisk: string[] = [];

    for (const [fixture, expectedHash] of Object.entries(manifest.fixtures)) {
      const canaryPath = path.join(seedsPath, `${fixture}.sha256`);
      if (!fs.existsSync(canaryPath)) {
        missingOnDisk.push(fixture);
        continue;
      }
      const actualHash = fs.readFileSync(canaryPath, 'utf-8').trim();
      if (actualHash !== expectedHash) {
        mismatches.push(
          `  ${fixture}: expected ${expectedHash.slice(0, 16)}…, got ${actualHash.slice(0, 16)}…`,
        );
      }
    }

    if (missingOnDisk.length > 0) {
      throw new Error(
        `lace-cli is missing .sha256 canaries for: ${missingOnDisk.join(', ')}. ` +
          `Check ${seedsPath} or update seed-manifest.json to drop these fixtures.`,
      );
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Seed hash mismatch — upstream lace-cli seeds have drifted:\n${mismatches.join('\n')}\n\n` +
          `Resolution: regenerate this manifest + rebaseline screenshots in the same PR.\n` +
          `  1. Update tests/flow/__snapshots__/seed-manifest.json with the new hashes\n` +
          `  2. Run \`pnpm flow-tests:update\` in the pinned Playwright CI container\n` +
          `  3. Commit both the manifest and the new baselines together`,
      );
    }
  });

  test('all fixtures referenced by flow stories have manifest entries', () => {
    const manifestPath = path.resolve(__dirname, '__snapshots__', 'seed-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;

    // Source of truth: the flow-story files themselves. Scan every
    // `fixtureName="..."` literal in packages/canvas-stories/src/stories/flows/.
    // When a story is added, the canary picks it up automatically —
    // no shadow list to keep in sync.
    const flowsDir = path.resolve(
      __dirname,
      '..',
      '..',
      'packages',
      'canvas-stories',
      'src',
      'stories',
      'flows',
    );
    const fixtureNamePattern = /fixtureName\s*=\s*"([^"]+)"/g;
    const storyFixtures = new Set<string>();
    for (const file of fs.readdirSync(flowsDir)) {
      if (!file.endsWith('.stories.tsx')) continue;
      const src = fs.readFileSync(path.join(flowsDir, file), 'utf-8');
      for (const m of src.matchAll(fixtureNamePattern)) {
        storyFixtures.add(m[1]);
      }
    }
    expect(storyFixtures.size, 'no flow stories found — path or glob may be wrong').toBeGreaterThan(
      0,
    );

    for (const fixture of storyFixtures) {
      expect(
        manifest.fixtures[fixture],
        `Flow story references fixture "${fixture}" but manifest has no entry for it.`,
      ).toBeTruthy();
    }
  });
});
