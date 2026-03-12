import { test, expect, describe, vi, beforeEach } from 'vitest';

// ── Mock @grpc/grpc-js before importing LaceClient ──

vi.mock('@grpc/grpc-js', () => ({
  credentials: { createInsecure: vi.fn() },
}));

// ── Capture the request passed to each registry gRPC method ──

const registryListSpy = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
  cb(null, { modules: [], page: 0, limit: 0, total: 0 });
});

const registryVersionSpy = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
  cb(null, {
    name: 'test',
    system: 'aws',
    version: 'v1.0.0',
    deploy_bundle: undefined,
    module_interface: undefined,
  });
});

const registryGetSpy = vi.fn((_req: unknown, cb: (err: null, res: unknown) => void) => {
  cb(null, { name: 'test', system: 'aws', versions: [] });
});

vi.mock('../../generated/proto/service', () => ({
  LaceEngineClient: vi.fn().mockImplementation(() => ({
    registryList: registryListSpy,
    registryVersion: registryVersionSpy,
    registryGet: registryGetSpy,
  })),
  NodeKind: { NODE_KIND_MODULE: 0, NODE_KIND_RESOURCE: 1, NODE_KIND_DATA: 2 },
  InputMode: {
    INPUT_MODE_EMPTY: 0,
    INPUT_MODE_LITERAL: 1,
    INPUT_MODE_VARIABLE: 2,
    INPUT_MODE_EXPRESSION: 3,
    INPUT_MODE_WIRED: 4,
  },
  DiagnosticSeverity: {
    DIAGNOSTIC_SEVERITY_ERROR: 0,
    DIAGNOSTIC_SEVERITY_WARNING: 1,
    DIAGNOSTIC_SEVERITY_INFO: 2,
  },
}));

import { LaceClient } from '../../utilities/engine/grpc-client';

describe('LaceClient org context', () => {
  let client: LaceClient;

  beforeEach(() => {
    client = new LaceClient(50051);
    registryListSpy.mockClear();
    registryVersionSpy.mockClear();
    registryGetSpy.mockClear();
  });

  // ── setOrgContext sets and clears org ──

  test('setOrgContext sets and clears org', async () => {
    client.setOrgContext('my-org');
    await client.listRegistryModules();
    expect(registryListSpy.mock.calls[0][0]).toHaveProperty('organization', 'my-org');

    client.setOrgContext(null);
    await client.listRegistryModules();
    expect(registryListSpy.mock.calls[1][0]).toHaveProperty('organization', '');
  });

  // ── Registry methods use orgContext as fallback ──

  test('listRegistryModules uses orgContext when no explicit org', async () => {
    client.setOrgContext('fallback-org');
    await client.listRegistryModules({ search: 'vpc' });

    expect(registryListSpy).toHaveBeenCalledOnce();
    expect(registryListSpy.mock.calls[0][0]).toHaveProperty('organization', 'fallback-org');
  });

  test('getRegistryVersion uses orgContext when no explicit org', async () => {
    client.setOrgContext('fallback-org');
    await client.getRegistryVersion({ name: 'test', system: 'aws', version: 'v1.0.0' });

    expect(registryVersionSpy).toHaveBeenCalledOnce();
    expect(registryVersionSpy.mock.calls[0][0]).toHaveProperty('organization', 'fallback-org');
  });

  test('getRegistryModule uses orgContext when no explicit org', async () => {
    client.setOrgContext('fallback-org');
    await client.getRegistryModule({ name: 'test', system: 'aws' });

    expect(registryGetSpy).toHaveBeenCalledOnce();
    expect(registryGetSpy.mock.calls[0][0]).toHaveProperty('organization', 'fallback-org');
  });

  // ── Explicit organization overrides orgContext ──

  test('explicit organization overrides orgContext on listRegistryModules', async () => {
    client.setOrgContext('default-org');
    await client.listRegistryModules({ organization: 'override-org' });

    expect(registryListSpy.mock.calls[0][0]).toHaveProperty('organization', 'override-org');
  });

  test('explicit organization overrides orgContext on getRegistryVersion', async () => {
    client.setOrgContext('default-org');
    await client.getRegistryVersion({
      name: 'test',
      system: 'aws',
      version: 'v1.0.0',
      organization: 'override-org',
    });

    expect(registryVersionSpy.mock.calls[0][0]).toHaveProperty('organization', 'override-org');
  });

  test('explicit organization overrides orgContext on getRegistryModule', async () => {
    client.setOrgContext('default-org');
    await client.getRegistryModule({ name: 'test', system: 'aws', organization: 'override-org' });

    expect(registryGetSpy.mock.calls[0][0]).toHaveProperty('organization', 'override-org');
  });

  // ── No org when neither is set ──

  test('uses empty string when neither orgContext nor explicit org is set', async () => {
    await client.listRegistryModules();
    expect(registryListSpy.mock.calls[0][0]).toHaveProperty('organization', '');

    await client.getRegistryVersion({ name: 'test', system: 'aws', version: 'v1.0.0' });
    expect(registryVersionSpy.mock.calls[0][0]).toHaveProperty('organization', '');

    await client.getRegistryModule({ name: 'test', system: 'aws' });
    expect(registryGetSpy.mock.calls[0][0]).toHaveProperty('organization', '');
  });
});
