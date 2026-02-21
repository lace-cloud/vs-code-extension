import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);

export async function syncModulesFromCLI() {
  const { stdout } = await exec('/usr/local/bin/lace', ['terraform-registry', 'list']);

  return stdout;
}
