import { describe, expect, test } from 'vitest';
import { shellLine } from '../shell-line';

const ARGS = 'stack create SLUG --source . --connection CONNECTION_ID';
const WINDOWS_CLI = 'C:\\Program Files\\lace\\lace.exe';
const QUOTED_CLI = "/opt/lace's tools/lace";

describe('a command line in the shell a terminal runs', () => {
  test.each([
    ['PowerShell 7', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'],
    ['PowerShell 7 on macOS and Linux', '/usr/local/bin/pwsh'],
    ['Windows PowerShell', 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    [
      'Windows PowerShell, spelled in capitals',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE',
    ],
  ])('%s calls the quoted path through the call operator, doubling each single quote', (_name, shell) => {
    expect(shellLine(shell, WINDOWS_CLI, ARGS)).toBe(`& '${WINDOWS_CLI}' ${ARGS}`);
    expect(shellLine(shell, QUOTED_CLI, ARGS)).toBe(`& '/opt/lace''s tools/lace' ${ARGS}`);
    // PowerShell reads the typographic single quotes as single quotes too.
    expect(shellLine(shell, 'C:\\Lace‘s ’tools‚ ‛x\\lace.exe', ARGS)).toBe(
      `& 'C:\\Lace‘‘s ’’tools‚‚ ‛‛x\\lace.exe' ${ARGS}`,
    );
  });

  test('Command Prompt calls the path in double quotes', () => {
    expect(shellLine('C:\\WINDOWS\\System32\\cmd.exe', WINDOWS_CLI, ARGS)).toBe(
      `"${WINDOWS_CLI}" ${ARGS}`,
    );
  });

  test("fish calls the path in single quotes, escaping \\ and ' inside them", () => {
    const fish = '/opt/homebrew/bin/fish';
    expect(shellLine(fish, '/usr/local/bin/lace', ARGS)).toBe(`'/usr/local/bin/lace' ${ARGS}`);
    expect(shellLine(fish, QUOTED_CLI, ARGS)).toBe(`'/opt/lace\\'s tools/lace' ${ARGS}`);
    expect(shellLine(fish, '/opt/lace\\tools/lace', ARGS)).toBe(
      `'/opt/lace\\\\tools/lace' ${ARGS}`,
    );
  });

  test.each([
    ['nushell', '/opt/homebrew/bin/nu'],
    ['nushell on Windows', 'C:\\Program Files\\nu\\bin\\nu.exe'],
  ])("%s runs the quoted path as an external program with the caret, a path holding ' as a raw string", (_name, shell) => {
    expect(shellLine(shell, WINDOWS_CLI, ARGS)).toBe(`^'${WINDOWS_CLI}' ${ARGS}`);
    expect(shellLine(shell, QUOTED_CLI, ARGS)).toBe(`^r#'/opt/lace's tools/lace'# ${ARGS}`);
    expect(shellLine(shell, "/opt/it's'#here/lace", ARGS)).toBe(
      `^r##'/opt/it's'#here/lace'## ${ARGS}`,
    );
  });

  test.each([
    ['sh', '/bin/sh'],
    ['bash', '/bin/bash'],
    ['zsh', '/bin/zsh'],
    ['dash', '/bin/dash'],
    ['Git Bash', 'C:\\Program Files\\Git\\bin\\bash.exe'],
    ['a host with no shell', ''],
  ])('%s calls the path in POSIX single quotes', (_name, shell) => {
    expect(shellLine(shell, '/usr/local/bin/lace', ARGS)).toBe(`'/usr/local/bin/lace' ${ARGS}`);
    expect(shellLine(shell, QUOTED_CLI, ARGS)).toBe(`'/opt/lace'\\''s tools/lace' ${ARGS}`);
  });
});
