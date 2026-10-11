import type { CanvasSource, CommandResult, SourceEnd, SourcePort } from '@lace-cloud/canvas/engine';
import type { Diagnostic } from '@lace-cloud/proto';
import { describe, expect, test } from 'vitest';
import type { RootSession } from '../../engine/root-sessions';
import { folder, uri } from '../../roots/__tests__/fake-uri';
import { VALIDATED } from '../../tools/__tests__/fake-session';
import { problemsObserver } from '../problems';
import { fakeProblemsApi } from './fake-problems-api';

// A session source as the mapping serves one: the latest frame and the last
// result per command path are replayed to a subscriber that joins later.
function fakeSource() {
  const frames = new Set<(s: CanvasSource) => void>();
  const ends = new Set<(e: SourceEnd) => void>();
  const results = new Set<(r: CommandResult) => void>();
  let latest: CanvasSource | null = null;
  const kept = new Map<string, CommandResult>();
  const source: SourcePort = {
    subscribe(on, onEnd, onCommandResult) {
      frames.add(on);
      ends.add(onEnd);
      if (onCommandResult) results.add(onCommandResult);
      if (latest) on(latest);
      if (onCommandResult) for (const result of kept.values()) onCommandResult(result);
      return () => {
        frames.delete(on);
        ends.delete(onEnd);
        if (onCommandResult) results.delete(onCommandResult);
      };
    },
  };
  return {
    source,
    subscribers: () => frames.size,
    frame(diagnostics: Diagnostic[], treeHash = 'tree-1') {
      latest = { diagnostics, treeHash } as unknown as CanvasSource;
      for (const on of [...frames]) on(latest);
    },
    result(path: string, document: unknown, exitCode = 0) {
      const result = { path, exitCode, document: JSON.stringify(document) };
      kept.set(path, result);
      for (const on of [...results]) on(result);
    },
    end(end: SourceEnd) {
      for (const on of [...ends]) on(end);
    },
  };
}

const session = (root: string, source: SourcePort): RootSession =>
  ({ root, sessionId: `session ${root}`, ports: { source } }) as unknown as RootSession;

// `module validate`'s report of a tree in Lace style, at `treeHash`.
const validate = (treeHash: string, diagnostics: object[]) => ({
  ...VALIDATED,
  root: '/work/repo/infra/prod',
  treeHash,
  diagnostics,
});

const repo = folder('/work/repo');
const PROD = '/work/repo/infra/prod';
const MAIN = 'file:///work/repo/infra/prod/main.tf';

function setup() {
  const fake = fakeProblemsApi([repo]);
  const reports: unknown[] = [];
  const observer = problemsObserver(fake.api, (_what, error) => reports.push(error));
  return { ...fake, observer, reports };
}

describe('Problems', () => {
  test("a root-relative file is a URI under the workspace folder's own URI", () => {
    const remote = { ...repo, uri: uri('/work/repo', 'vscode-remote', 'ssh-remote+host') };
    const fake = fakeProblemsApi([remote]);
    const source = fakeSource();
    problemsObserver(fake.api, () => {})(session(PROD, source.source));

    source.frame([
      { severity: 'error', message: 'unrepresentable', file: 'modules/a.tf', line: 3, column: 5 },
    ]);
    expect(fake.shown()).toEqual({
      'vscode-remote://ssh-remote+host/work/repo/infra/prod/modules/a.tf': ['unrepresentable'],
    });
    const [problem] = [...fake.collections[0].entries.values()][0];
    expect(problem.range).toMatchObject({ startLine: 2, startCharacter: 4 });
    expect(problem).toMatchObject({ severity: 0, source: 'lace' });
  });

  test('a diagnostic with a file and no line is at line 1; one with no file is skipped, and stays on the canvas', () => {
    const { observer, shown, collections } = setup();
    const source = fakeSource();
    observer(session(PROD, source.source));

    source.frame([
      { severity: 'warning', message: 'no line', file: 'variables.tf' },
      { severity: 'error', message: 'input not set', module_key: 'm', instance_id: 'vpc' },
    ]);
    expect(shown()).toEqual({
      'file:///work/repo/infra/prod/variables.tf': ['no line'],
    });
    const lines = [...collections[0].entries.values()].map(([d]) => d.range.startLine);
    expect(lines).toEqual([0]);
  });

  test("a diagnostic's code is the problem's code", () => {
    const { observer, collections } = setup();
    const source = fakeSource();
    observer(session(PROD, source.source));
    source.result('module scan', {
      treeHash: 'tree-1',
      diagnostics: [{ severity: 'warning', code: 'AVD-AWS-0086', message: 'public', file: 'a.tf' }],
    });
    source.frame([]);
    const [[problem]] = [...collections[0].entries.values()];
    expect(problem.code).toBe('AVD-AWS-0086');
  });

  test("shows the session's live findings and its current report, a finding both carry once", () => {
    const { observer, shown } = setup();
    const source = fakeSource();
    observer(session(PROD, source.source));

    const residual = { severity: 'error', message: 'residual', file: 'main.tf', line: 2 } as const;
    source.frame([residual]);
    source.result(
      'module validate',
      validate('tree-1', [
        residual,
        { severity: 'error', message: 'tf', file: 'main.tf', line: 9 },
      ]),
    );
    expect(shown()).toEqual({ [MAIN]: ['residual', 'tf'] });
  });

  test("drops a report whole when the session's tree hash moves, as the canvas does", () => {
    const { observer, shown } = setup();
    const source = fakeSource();
    observer(session(PROD, source.source));
    source.frame([], 'tree-1');
    source.result(
      'module validate',
      validate('tree-1', [{ severity: 'error', message: 'tf', file: 'main.tf' }]),
    );
    expect(shown()).toEqual({ [MAIN]: ['tf'] });

    source.frame([], 'tree-2');
    expect(shown()).toEqual({});
  });

  test('a result the session published before Problems subscribed is shown', () => {
    const { observer, shown } = setup();
    const source = fakeSource();
    source.frame([], 'tree-1');
    source.result(
      'module validate',
      validate('tree-1', [{ severity: 'error', message: 'run earlier', file: 'main.tf' }]),
    );

    observer(session(PROD, source.source));
    expect(shown()).toEqual({ [MAIN]: ['run earlier'] });
  });

  test("a command's failure names no file, so it stays on the canvas and out of Problems", () => {
    const { observer, shown } = setup();
    const source = fakeSource();
    observer(session(PROD, source.source));
    source.frame([{ severity: 'error', message: 'live', file: 'main.tf' }]);
    source.result('module scan', { reason: 'unspecified', message: 'the scan stopped' }, 1);
    expect(shown()).toEqual({ [MAIN]: ['live'] });
  });

  test("one collection per root: one root's end clears its own entries and leaves the other's", () => {
    const { observer, shown, collections } = setup();
    const prod = fakeSource();
    const stage = fakeSource();
    observer(session(PROD, prod.source));
    const detachStage = observer(session('/work/repo/infra/stage', stage.source));
    prod.frame([{ severity: 'error', message: 'prod', file: 'main.tf' }]);
    stage.frame([{ severity: 'error', message: 'stage', file: 'main.tf' }]);
    expect(collections).toHaveLength(2);

    stage.end({ kind: 'closed' });
    expect(shown()).toEqual({ [MAIN]: ['prod'] });

    detachStage.dispose();
    expect(collections[1].disposed).toBe(true);
    expect(stage.subscribers()).toBe(0);
    expect(shown()).toEqual({ [MAIN]: ['prod'] });
  });

  test('a document Problems cannot read is reported, and the next one is shown', () => {
    const { observer, shown, reports } = setup();
    const source = fakeSource();
    observer(session(PROD, source.source));
    source.frame([]);

    source.result('module validate', { not: 'a report' });
    expect(reports).toHaveLength(1);

    source.result(
      'module validate',
      validate('tree-1', [{ severity: 'error', message: 'later', file: 'main.tf' }]),
    );
    expect(shown()).toEqual({ [MAIN]: ['later'] });
  });

  test('a root under no workspace folder is reported and shows nothing', () => {
    const { observer, collections, reports } = setup();
    const detach = observer(session('/elsewhere/infra', fakeSource().source));
    expect(collections).toEqual([]);
    expect(reports).toHaveLength(1);
    detach.dispose();
  });
});
