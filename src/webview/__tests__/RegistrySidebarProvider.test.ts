import { describe, expect, test, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { RegistrySidebarProvider } from '../../containers-views/RegistrySidebarProvider';
import type { RegistryModule } from '../../types/protocol';

const GOOGLE_STORAGE_BUCKET: RegistryModule = {
  id: 'google/storage-bucket',
  name: 'storage-bucket',
  system: 'google',
  version: '1.0.0',
  description: 'Google Cloud storage bucket module',
};

describe('RegistrySidebarProvider', () => {
  test('fetches org-scoped google modules and keeps overlapping alias results deduplicated', async () => {
    const listRegistryModules = vi.fn(
      async ({
        system,
        organization,
      }: {
        system?: string;
        organization?: string;
      }) => {
        if (organization === 'qxf2' && (system === 'google' || system === 'gcp')) {
          return { modules: [GOOGLE_STORAGE_BUCKET] };
        }
        return { modules: [] };
      },
    );

    const provider = new RegistrySidebarProvider(
      undefined,
      { appendLine: vi.fn() } as unknown as never,
    );
    provider.setRpcClient({ listRegistryModules } as never);
    (provider as unknown as { selectedOrg: string | null }).selectedOrg = 'qxf2';

    await provider.refresh(true);

    expect(listRegistryModules).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'google', organization: 'qxf2' }),
    );
    expect(provider.getModules()).toEqual([GOOGLE_STORAGE_BUCKET]);
  });
});
