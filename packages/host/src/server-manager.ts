import { type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { LaceTransport } from './transport';
import { spawnEngine } from './engine-process';
import type { ServerState } from './types';

type ServerManagerOpts = {
  log: (msg: string) => void;
  getBinaryPath: () => string;
  getAutoRestart: () => boolean;
};

export class ServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private _transport: LaceTransport | null = null;
  private state: ServerState = 'stopped';
  private restartCount = 0;
  private restartScheduled = false;
  private readonly maxRestarts = 3;
  private readonly log: (msg: string) => void;
  private readonly getBinaryPath: () => string;
  private readonly getAutoRestart: () => boolean;

  constructor(opts: ServerManagerOpts) {
    super();
    this.log = opts.log;
    this.getBinaryPath = opts.getBinaryPath;
    this.getAutoRestart = opts.getAutoRestart;
  }

  get transport(): LaceTransport | null {
    return this._transport;
  }

  get currentState(): ServerState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      return;
    }

    this.setState('starting');
    const binaryPath = this.getBinaryPath();
    this.log(`Starting engine: ${binaryPath}`);

    try {
      const { process: proc, handshake } = await spawnEngine(binaryPath, this.log);
      this.process = proc;

      proc.on('error', (err) => {
        this.log(`Process error: ${err.message}`);
        this.emit('error', err);
        this.setState('stopped');
        this.maybeRestart();
      });

      proc.on('exit', (code) => {
        this.log(`Process exited with code ${code}`);
        this.setState('stopped');
        if (code !== 0) {
          this.maybeRestart();
        }
      });

      this._transport = new LaceTransport(handshake.port, handshake.token);
      await this._transport.initialize(handshake.version);

      this.restartCount = 0;
      this.log('Engine initialized successfully');
      this.setState('running');
    } catch (err: unknown) {
      this.log(`Start failed: ${err instanceof Error ? err.message : String(err)}`);
      this.setState('error');
      throw err;
    }
  }

  async stop(): Promise<void> {
    try {
      await this._transport?.shutdown();
    } catch {
      // Swallow shutdown errors — we are tearing down.
    }

    this._transport?.dispose();
    this.process?.kill();

    this._transport = null;
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
    this.log(`State: ${this.state} -> ${state}`);
    this.state = state;
    this.emit('state', state);
  }

  private maybeRestart(): void {
    if (this.restartCount >= this.maxRestarts) {
      this.log(`Max restarts (${this.maxRestarts}) exhausted — giving up`);
      return;
    }

    if (this.restartScheduled) {
      return;
    }

    if (!this.getAutoRestart()) {
      return;
    }

    this.restartScheduled = true;
    this.restartCount++;
    const delayMs = 1000 * Math.pow(2, this.restartCount - 1);
    this.log(`Scheduling restart ${this.restartCount}/${this.maxRestarts} in ${delayMs}ms`);
    setTimeout(() => {
      this.restartScheduled = false;
      this.start();
    }, delayMs);
  }
}
