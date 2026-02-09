import { execFile } from 'child_process';
import { promisify } from 'util';
import { JSONRPCClient } from '../utilities/engine/rpc-client';

const exec = promisify(execFile);

export interface RegistryListResult {
  modules: any[];
  pagination?: any;
}

export class TerraformRegistryService {
  constructor(
    private rpc: JSONRPCClient | null,
    private laceBinary = '/usr/local/bin/lace'
  ) {}

  /* ---------------- Registry List ---------------- */

  async listModules(params?: {
    system?: string;
    search?: string;
    category?: string;
    kind?: string;
    page?: number;
    limit?: number;
    organization?: string;
  }): Promise<RegistryListResult> {
    // ✅ RPC path
    if (this.rpc) {
      return await this.rpc.listRegistryModules(params);
    }

    // ⚠️ CLI fallback
    const args = [
      'terraform-registry',
      'list',
      '--output',
      'json',
    ];

    if (params?.system) args.push('--system', params.system);
    if (params?.search) args.push('--search', params.search);
    if (params?.category) args.push('--category', params.category);
    if (params?.kind) args.push('--kind', params.kind);
    if (params?.page) args.push('--page', String(params.page));
    if (params?.limit) args.push('--limit', String(params.limit));
    if (params?.organization) args.push('--organization', params.organization);

    const { stdout } = await exec(this.laceBinary, args);
    const parsed = JSON.parse(stdout);

    return {
      modules: parsed.modules ?? [],
      pagination: parsed.pagination,
    };
  }

  /* ---------------- Registry Version ---------------- */

  async getModuleVersion(
    name: string,
    system: string,
    version: string,
    organization?: string
  ): Promise<any> {
    // ✅ RPC path
    if (this.rpc) {
      return await this.rpc.getRegistryVersion({
        name,
        system,
        version,
        organization,
      });
    }

    // ⚠️ CLI fallback
    const args = [
      'terraform-registry',
      'version',
      name,
      system,
      version,
      '--output',
      'json',
    ];

    if (organization) args.push('--organization', organization);

    const { stdout } = await exec(this.laceBinary, args);
    return JSON.parse(stdout);
  }
}
