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

  constructor() {
    super();
  }

  get rpcClient(): JSONRPCClient | null {
    return this.client;
  }

  async start(): Promise<void> {
    if (this.state !== 'stopped') {
      return;
    }

    this.setState('starting');

    const binaryPath = vscode.workspace
      .getConfiguration('lace')
      .get<string>('binaryPath', '/usr/local/bin/lace');

    try {
      this.process = spawn(binaryPath, ['module', 'serve'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stderr?.on('data', (d) => console.warn('[lace]', d.toString()));

      this.process.on('exit', (code) => {
        this.setState('stopped');
        if (code !== 0) {
          this.maybeRestart();
        }
      });

      this.client = new JSONRPCClient(this.process);

      await this.client.initialize('0.1.0');

      this.setState('running');
    } catch (err) {
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
    this.state = state;
    this.emit('state', state);
  }

  private maybeRestart(): void {
    if (this.restartCount >= this.maxRestarts) {
      return;
    }

    const autoRestart = vscode.workspace.getConfiguration('lace').get<boolean>('autoRestart', true);

    if (!autoRestart) {
      return;
    }

    this.restartCount++;
    setTimeout(() => this.start(), 1000 * this.restartCount);
  }
}
