// The repository's configuration names only what exists: each tsconfig
// includes directories that hold tracked files, and each workflow runs on
// the branches of the branch flow, `develop` and `main`. It reads the
// index, never the working tree.
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' });

const tracked = (pattern: string): string[] => git('ls-files', pattern).split('\n').filter(Boolean);

// A path pattern's directory: the part before its first wildcard.
const directoryOf = (pattern: string): string => pattern.split(/[*?{[]/)[0];

const BRANCH_FLOW = ['develop', 'main'];

describe('the configuration', () => {
  test('every directory a tsconfig includes holds tracked files', () => {
    const empty: string[] = [];
    for (const path of tracked('*tsconfig*.json')) {
      const config = JSON.parse(git('show', `:${path}`));
      const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
      for (const include of config.include ?? []) {
        const directory = `${base}${directoryOf(include)}`;
        if (tracked(directory).length === 0) empty.push(`${path}: ${include}`);
      }
    }
    expect(empty).toEqual([]);
  });

  test('every workflow runs on the branches of the branch flow alone', () => {
    const named: string[] = [];
    for (const path of tracked('.github/workflows/*.yml')) {
      for (const [, list] of git('show', `:${path}`).matchAll(/^\s*branches:\s*\[([^\]]*)\]/gm)) {
        for (const branch of list.split(',').map((each) => each.trim())) {
          if (!BRANCH_FLOW.includes(branch)) named.push(`${path}: ${branch}`);
        }
      }
    }
    expect(named).toEqual([]);
  });
});
