// src/engine/rpc-client.ts
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';

interface RPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface RPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class JSONRPCClient extends EventEmitter {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private rl: readline.Interface | null = null;

  constructor(
    private process: ChildProcess,
    private timeoutMs = 30_000
  ) {
    super();
    this.setupReader();
  }

  private setupReader(): void {
    if (!this.process.stdout) return;

    this.rl = readline.createInterface({
      input: this.process.stdout,
    });

    this.rl.on('line', (line) => {
      try {
        const msg: RPCResponse = JSON.parse(line);
        const pending = this.pending.get(msg.id);
        if (!pending) return;

        clearTimeout(pending.timeout);
        this.pending.delete(msg.id);

        if (msg.error) {
          pending.reject(
            new Error(
              `${msg.error.message}${
                msg.error.data ? `: ${JSON.stringify(msg.error.data)}` : ''
              }`
            )
          );
        } else {
          pending.resolve(msg.result);
        }
      } catch (err) {
        this.emit('error', err);
      }
    });
  }

  call<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    const request: RPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout,
      });

      this.process.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  // ---------- Core ----------
  initialize(clientVersion: string) {
    return this.call<{ serverVersion: string; capabilities?: string[] }>(
      'initialize',
      { clientVersion }
    );
  }

  shutdown() {
    return this.call<{ status: string }>('shutdown');
  }

  // ---------- Registry ----------
  listRegistryModules(params?: {
    system?: string;
    search?: string;
    category?: string;
    kind?: string;
    page?: number;
    limit?: number;
    organization?: string;
  }) {
    return this.call<{
      modules: any[];
      pagination?: any;
    }>('registry/list', params);
  }

  getRegistryVersion(params: {
    name: string;
    system: string;
    version: string;
    organization?: string;
  }) {
    return this.call<any>('registry/version', params);
  }

  dispose(): void {
    this.rl?.close();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disposed'));
    }
    this.pending.clear();
  }
}
