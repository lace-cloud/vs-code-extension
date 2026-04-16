import { type ChildProcess, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import type { EngineHandshake } from './types';

const HANDSHAKE_TIMEOUT_MS = 10_000;

const VERSION_RE = /^LACE_ENGINE_VERSION=(.+)$/;
const PROTOCOL_RE = /^LACE_ENGINE_PROTOCOL_VERSION=(\d+)$/;
const PORT_RE = /^LACE_ENGINE_PORT=(\d+)$/;
const TOKEN_RE = /^LACE_ENGINE_TOKEN=([0-9a-fA-F]{64})$/;
const READY_LINE = 'LACE_ENGINE_READY';

/**
 * Spawn `lace engine` and parse the 5-line handshake:
 *   LACE_ENGINE_VERSION=<semver>
 *   LACE_ENGINE_PROTOCOL_VERSION=<integer>
 *   LACE_ENGINE_PORT=<port>
 *   LACE_ENGINE_TOKEN=<64 hex chars>
 *   LACE_ENGINE_READY
 */
export function spawnEngine(
  binaryPath: string,
  log: (msg: string) => void,
): Promise<{ process: ChildProcess; handshake: EngineHandshake }> {
  return new Promise((resolve, reject) => {
    log(`Spawning: ${binaryPath} engine`);

    const proc = spawn(binaryPath, ['engine'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stderr?.on('data', (data: Buffer) => {
      log(`[stderr] ${data.toString().trimEnd()}`);
    });

    const rl = readline.createInterface({ input: proc.stdout! });

    let version: string | undefined;
    let protocolVersion: string | undefined;
    let port: number | undefined;
    let token: string | undefined;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rl.close();
      proc.kill();
      reject(new Error('Timed out waiting for engine handshake'));
    }, HANDSHAKE_TIMEOUT_MS);

    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      proc.kill();
      reject(new Error(reason));
    };

    rl.on('line', (line) => {
      if (settled) return;

      log(`[stdout] ${line}`);

      let match: RegExpMatchArray | null;

      match = line.match(VERSION_RE);
      if (match) {
        version = match[1];
        return;
      }

      match = line.match(PROTOCOL_RE);
      if (match) {
        protocolVersion = match[1];
        return;
      }

      match = line.match(PORT_RE);
      if (match) {
        port = Number(match[1]);
        return;
      }

      match = line.match(TOKEN_RE);
      if (match) {
        token = match[1];
        return;
      }

      if (line === READY_LINE) {
        if (!version || !protocolVersion || port === undefined || !token) {
          fail('Received LACE_ENGINE_READY before all handshake fields were set');
          return;
        }

        settled = true;
        clearTimeout(timer);
        rl.close();

        resolve({
          process: proc,
          handshake: { version, protocolVersion, port, token },
        });
      }
    });

    proc.on('error', (err) => {
      fail(`Failed to spawn engine: ${err.message}`);
    });

    proc.on('exit', (code) => {
      fail(`Engine exited with code ${code} before completing handshake`);
    });
  });
}
