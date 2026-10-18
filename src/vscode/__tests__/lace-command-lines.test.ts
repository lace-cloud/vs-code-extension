import { describe, expect, test, vi } from 'vitest';
import { outsideSignals } from '../../account/__tests__/fake-outside';
import { onDidEndLaceCommand } from '../lace-command-lines';

// What the window is told of `line` ending in an integrated terminal.
function told(line: string): unknown[] {
  const outside = outsideSignals();
  const ran = vi.fn();
  onDidEndLaceCommand(outside.window, ran);
  outside.ended(line);
  return ran.mock.calls.map(([command]) => command);
}

describe('a lace command line ending in an integrated terminal', () => {
  test.each([
    ['lace stack destroy prod --yes', 'stack destroy'],
    ['  lace whoami', 'whoami'],
    ['/usr/local/bin/lace run cancel run_1', 'run cancel'],
    ['C:\\Users\\dev\\bin\\lace.exe login', 'login'],
    ['lace -o json stack list', 'stack list'],
    ['lace --org acme stack apply prod', 'stack apply'],
    ['lace --timeout 1m org list', 'org list'],
    ['lace stack list --source infra/prod -o json', 'stack list'],
    ['lace module validate', 'module validate'],
  ])('%s is told as the CLI command %s', (line, path) => {
    expect(told(line)).toEqual([{ path }]);
  });

  test.each([
    'lace',
    'lace --help',
    'lace engine',
    'lace stak list',
    'lace help stack apply',
    'lace --org module validate',
  ])('%s is told as naming no command of the CLI', (line) => {
    expect(told(line)).toEqual([{ path: undefined }]);
  });

  test.each([
    'git status',
    'echo lace stack destroy prod',
    'palace stack list',
    'lacework scan',
  ])('%s runs another program, and nothing is told', (line) => {
    expect(told(line)).toEqual([]);
  });

  test('once disposed, nothing is told', () => {
    const outside = outsideSignals();
    const ran = vi.fn();
    onDidEndLaceCommand(outside.window, ran).dispose();
    outside.ended('lace whoami');
    expect(ran).not.toHaveBeenCalled();
  });
});
