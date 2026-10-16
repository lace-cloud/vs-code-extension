// Problems over a real engine's session: the report a command published to
// the session is shown, by the same fold the canvas runs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { moduleDirectory, realEngine, until } from '../../engine/__tests__/real-engine';
import { commandOutcome } from '../../engine/command-outcome';
import { file, folder } from '../../roots/__tests__/fake-uri';
import { problemsObserver } from '../problems';
import { fakeProblemsApi } from './fake-problems-api';

// A module in Lace style that Terraform refuses: its output calls a function
// Terraform does not have, which Lace's own rules do not read.
const BROKEN =
  'variable "name" {\n  type = string\n}\n\noutput "x" {\n  value = nofunc(var.name)\n}\n';
const FIXED = 'variable "name" {\n  type = string\n}\n\noutput "x" {\n  value = var.name\n}\n';

describe('Problems on the real engine', () => {
  test('a Validate the session published before Problems subscribed is shown, and dropped when the tree moves', async () => {
    const { repository, root } = moduleDirectory({ 'main.tf': BROKEN });
    const { rootSessions, commands, reports } = realEngine();
    await rootSessions.acquire(root);

    const outcome = await commandOutcome(await commands.at(root), 'module validate', {});
    expect(outcome.kind).toBe('result');

    const fake = fakeProblemsApi([folder(repository)]);
    rootSessions.observe(problemsObserver(fake.api, (_what, error) => reports.push(error)));
    const main = file(join(root, 'main.tf')).toString();
    await until('the report in Problems', () => fake.shown()[main] !== undefined);
    expect(fake.shown()[main]).toEqual([expect.stringContaining('no function named "nofunc"')]);
    const [[problem]] = [...fake.collections[0].entries.values()];
    expect(problem.range).toMatchObject({ startLine: 5, startCharacter: 10 });

    writeFileSync(join(root, 'main.tf'), FIXED);
    await until('the report dropped', () => fake.shown()[main] === undefined);
    expect(reports).toEqual([]);
  });
});
