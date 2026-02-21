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
    private timeoutMs = 30_000,
  ) {
    super();
    this.setupReader();
  }

  private setupReader(): void {
    if (!this.process.stdout) {
      return;
    }

    this.rl = readline.createInterface({
      input: this.process.stdout,
    });

    this.rl.on('line', (line) => {
      line = line.trim();

      if (!line.startsWith('{')) {
        console.warn('[lace][stdout]', line);
        return;
      }

      try {
        const msg: RPCResponse = JSON.parse(line);

        const pending = this.pending.get(msg.id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timeout);
        this.pending.delete(msg.id);

        if (msg.error) {
          pending.reject(
            new Error(
              `${msg.error.message}${msg.error.data ? `: ${JSON.stringify(msg.error.data)}` : ''}`,
            ),
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

  initialize(clientVersion: string) {
    return this.call<{ serverVersion: string; capabilities?: string[] }>('initialize', {
      clientVersion,
    });
  }

  shutdown() {
    return this.call<{ status: string }>('shutdown');
  }

  listRegistryModules(params?: {
    system?: string;
    search?: string;
    category?: string;
    kind?: string;
    page?: number;
    limit?: number;
    organization?: string;
  }) {
    return this.call<{ modules: any[]; pagination?: any }>('registry/list', params);
  }

  getRegistryVersion(params: {
    name: string;
    system: string;
    version: string;
    organization?: string;
  }) {
    return this.call<any>('registry/version', params);
  }

  getRegistryModule(params: { name: string; system: string; organization?: string }) {
    return this.call<{ name: string; system: string; versions: any[] }>('registry/get', params);
  }

  // ✅ generate
  generate(params: {
    bundle: any;
    outputDir: string;
    options?: {
      dryRun?: boolean;
      format?: boolean;
      validate?: boolean;
      overwrite?: boolean;
    };
  }) {
    return this.call<{ filesWritten?: string[]; diagnostics?: any[] }>('generate', params);
  }

  // ✅ validate
  validate(params: { bundle: any }) {
    return this.call<{
      valid?: boolean;
      diagnostics?: Array<{
        severity: string;
        message: string;
        file?: string;
        line?: number;
        column?: number;
      }>;
    }>('validate', params);
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
