import { execFile } from 'child_process';
import { promisify } from 'util';
// import sqlite3 from 'sqlite3';
// import path from 'path';

const exec = promisify(execFile);


export async function syncModulesFromCLI() {
  const { stdout } = await exec('/usr/local/bin/lace', [
    'terraform-registry',
    'list'
  ]);

  return stdout;

}


