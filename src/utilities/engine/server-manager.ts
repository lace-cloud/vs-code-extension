// src/utilities/engine/server-manager.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import * as vscode from 'vscode';
import { LaceClient, type AuthStatusResult, type AuthLoginResult } from './grpc-client';

export type ServerState = 'stopped' | 'starting' | 'running' | 'error';

/** Reads stdout line-by-line looking for `LACE_GRPC_PORT=<number>`. */
function waitForPort(proc: ChildProcess, timeoutMs = 10_000): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    if (!proc.stdout) {
      reject(new Error('Process has no stdout'));
      return;
    }

    const rl = readline.createInterface({ input: proc.stdout });
    const timer = setTimeout(() => {
      rl.close();
      reject(new Error('Timed out waiting for LACE_GRPC_PORT'));
    }, timeoutMs);

    rl.on('line', (line) => {
      const match = line.match(/^LACE_GRPC_PORT=(\d+)$/);
      if (match) {
        clearTimeout(timer);
        rl.close();
        resolve(Number(match[1]));
      }
    });

    rl.on('close', () => {
      clearTimeout(timer);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      rl.close();
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      rl.close();
      reject(new Error(`Process exited with code ${code} before printing LACE_GRPC_PORT`));
    });
  });
}

export class ServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private client: LaceClient | null = null;
  private state: ServerState = 'stopped';
  private restartCount = 0;
  private readonly maxRestarts = 3;
  private outputChannel: vscode.OutputChannel | null = null;
  private restartScheduled = false;

  constructor(outputChannel?: vscode.OutputChannel) {
    super();
    this.outputChannel = outputChannel ?? null;
  }

  private log(msg: string): void {
    this.outputChannel?.appendLine(`[${new Date().toISOString()}] ${msg}`);
  }

  get rpcClient(): LaceClient | null {
    return this.client;
  }

  get currentState(): ServerState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      return;
    }

    this.setState('starting');

    const binaryPath = vscode.workspace
      .getConfiguration('lace')
      .get<string>('binaryPath', '/usr/local/bin/lace');

    this.log(`Starting engine: ${binaryPath} module serve`);

    try {
      this.process = spawn(binaryPath, ['module', 'serve'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stderr?.on('data', (d) => {
        const text = d.toString().trimEnd();
        this.log(`[stderr] ${text}`);
      });

      // Wait for the gRPC port before attaching process lifecycle handlers,
      // so that early exits during port-wait are caught by waitForPort.
      const port = await waitForPort(this.process);
      this.log(`gRPC port: ${port}`);

      this.process.on('error', (err) => {
        this.log(`Process error: ${err.message}`);
        this.emit('error', err);
        this.setState('stopped');
        this.maybeRestart();
      });

      this.process.on('exit', (code) => {
        this.log(`Process exited with code ${code}`);
        this.setState('stopped');
        if (code !== 0) {
          this.maybeRestart();
        }
      });

      this.client = new LaceClient(port);

      await this.client.initialize('0.1.0');

      this.restartCount = 0;
      this.log('Engine initialized successfully');
      this.setState('running');

      // Check auth status after initialization
      try {
        const authStatus = await this.client.authStatus();
        this.emit('auth', authStatus);
      } catch (err: unknown) {
        this.log(`Auth status check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err: unknown) {
      this.log(`Start failed: ${err instanceof Error ? err.message : String(err)}`);
      this.outputChannel?.show(true);
      this.setState('error');
      throw err;
    }
  }

  async stop(): Promise<void> {
    try {
      await this.client?.shutdown();
    } catch {}

    this.client?.dispose();
    this.process?.kill();

    this.client = null;
    this.process = null;
    this.setState('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async login(token: string): Promise<AuthLoginResult> {
    if (!this.client) throw new Error('Engine not running');
    const result = await this.client.authLogin({ token });
    if (result.success) {
      this.emit('auth', { authenticated: true, user: result.user });
    }
    return result;
  }

  async logout(): Promise<void> {
    if (!this.client) throw new Error('Engine not running');
    const result = await this.client.authLogout();
    if (result.success) {
      this.emit('auth', { authenticated: false });
    }
  }

  async checkAuth(): Promise<AuthStatusResult | null> {
    if (!this.client) return null;
    try {
      const status = await this.client.authStatus();
      this.emit('auth', status);
      return status;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.stop();
  }

  private setState(state: ServerState): void {
    this.log(`State: ${this.state} → ${state}`);
    this.state = state;
    this.emit('state', state);
  }

  private maybeRestart(): void {
    if (this.restartCount >= this.maxRestarts) {
      this.log(`Max restarts (${this.maxRestarts}) exhausted — giving up`);
      this.outputChannel?.show(true);
      return;
    }

    if (this.restartScheduled) {
      return;
    }

    const autoRestart = vscode.workspace.getConfiguration('lace').get<boolean>('autoRestart', true);

    if (!autoRestart) {
      return;
    }

    this.restartScheduled = true;
    this.restartCount++;
    const delayMs = 1000 * this.restartCount;
    this.log(`Scheduling restart ${this.restartCount}/${this.maxRestarts} in ${delayMs}ms`);
    setTimeout(() => {
      this.restartScheduled = false;
      this.start();
    }, delayMs);
  }
}
