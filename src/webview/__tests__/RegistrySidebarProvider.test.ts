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
  test('fetches org-scoped google modules', async () => {
    const listRegistryModules = vi.fn(
      async ({
        system,
        organization,
      }: {
        system?: string;
        organization?: string;
      }) => {
        if (organization === 'qxf2' && system === 'google') {
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

  test('shows login message when registry fetch fails and auth status is false', async () => {
    const authStatus = vi.fn(async () => ({ authenticated: false }));
    const listRegistryModules = vi.fn(async () => {
      throw new Error('registry not configured');
    });

    const provider = new RegistrySidebarProvider(
      undefined,
      { appendLine: vi.fn() } as unknown as never,
    );
    provider.setAuthenticated(true);
    provider.setRpcClient({ authStatus, listRegistryModules } as never);

    await provider.refresh(true);

    expect(authStatus).toHaveBeenCalledOnce();
    expect(
      (provider as unknown as { errorMessage: string | null }).errorMessage,
    ).toBe('Please log in to access the module registry.');
  });

  test('keeps engine unavailable message when registry fetch fails and auth status is true', async () => {
    const authStatus = vi.fn(async () => ({ authenticated: true }));
    const listRegistryModules = vi.fn(async () => {
      throw new Error('registry not configured');
    });

    const provider = new RegistrySidebarProvider(
      undefined,
      { appendLine: vi.fn() } as unknown as never,
    );
    provider.setAuthenticated(true);
    provider.setRpcClient({ authStatus, listRegistryModules } as never);

    await provider.refresh(true);

    expect(authStatus).toHaveBeenCalledOnce();
    expect(
      (provider as unknown as { errorMessage: string | null }).errorMessage,
    ).toBe('Lace engine is not available. Start it with "Lace: Start Engine".');
  });
});
