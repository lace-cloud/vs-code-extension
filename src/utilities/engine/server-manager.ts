// src/utilities/engine/server-manager.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { JSONRPCClient } from './rpc-client';

export type ServerState = 'stopped' | 'starting' | 'running' | 'error';

export class ServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private client: JSONRPCClient | null = null;
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

  get rpcClient(): JSONRPCClient | null {
    return this.client;
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

      this.client = new JSONRPCClient(this.process, 30_000, this.outputChannel);

      await this.client.initialize('0.1.0');

      this.restartCount = 0;
      this.log('Engine initialized successfully');
      this.setState('running');
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
