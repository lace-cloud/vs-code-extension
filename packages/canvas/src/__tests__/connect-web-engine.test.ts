// @vitest-environment happy-dom
import { describe, test, expect, vi } from 'vitest';
import { ConnectWebEngine, ConnectError } from '../connect-web-engine';
import type { EngineEvent } from '../engine';

// Connect-JSON wire format uses camelCase on the wire (Connect default), even
// though our ts-proto interfaces keep snake_case field names (snakeToCamel=false).
// Tests assert the camelCase wire format.

const BASE_URL = 'http://127.0.0.1:12345';
const TOKEN = 'test-token-abc';

function mockJsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('ConnectWebEngine — URL shape and headers', () => {
  test('sessionOpen POSTs to /lace.engine.LaceEngine/SessionOpen with bearer auth', async () => {
    const fetchImpl = mockJsonFetch(200, {
      sessionId: 'sess-1',
      view: {
        moduleName: 'test',
        nodes: [],
        edges: [],
        errors: [],
        canUndo: false,
        canRedo: false,
        isDirty: false,
        groups: [],
      },
    });
    const engine = new ConnectWebEngine({ baseUrl: BASE_URL, token: TOKEN, fetch: fetchImpl });

    const view = await engine.sessionOpen('/tmp/lace', 'test-workspace');

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/lace.engine.LaceEngine/SessionOpen`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    });
    expect(JSON.parse(init.body)).toEqual({
      backed: { filePath: '/tmp/lace' },
      workspaceName: 'test-workspace',
    });
    expect(view.module_name).toBe('test');
    expect(engine.sessionId).toBe('sess-1');
  });

  test('trailing slash on baseUrl is stripped', async () => {
    const fetchImpl = mockJsonFetch(200, { saved: true });
    const engine = new ConnectWebEngine({
      baseUrl: `${BASE_URL}/`,
      token: TOKEN,
      sessionId: 'sess-2',
      fetch: fetchImpl,
    });
    await engine.sessionSave();
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE_URL}/lace.engine.LaceEngine/SessionSave`);
  });
});

describe('ConnectWebEngine — session_id injection', () => {
  test('placeModule uses active session_id', async () => {
    const emptyView = {
      moduleName: 'test',
      nodes: [],
      edges: [],
      errors: [],
      canUndo: false,
      canRedo: false,
      isDirty: false,
      groups: [],
    };
    const fetchImpl = mockJsonFetch(200, emptyView);
    const engine = new ConnectWebEngine({
      baseUrl: BASE_URL,
      token: TOKEN,
      sessionId: 'active-sess',
      fetch: fetchImpl,
    });

    await engine.placeModule({ name: 'iam-role', system: 'aws', version: '1.0.0' });

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.sessionId).toBe('active-sess');
    expect(body.name).toBe('iam-role');
    expect(body.system).toBe('aws');
    expect(body.version).toBe('1.0.0');
  });

  test('queries throw before sessionOpen', async () => {
    const fetchImpl = mockJsonFetch(200, {});
    const engine = new ConnectWebEngine({ baseUrl: BASE_URL, token: TOKEN, fetch: fetchImpl });
    await expect(engine.querySettings()).rejects.toThrow(/No active session/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ConnectWebEngine — error mapping', () => {
  test('non-2xx response throws ConnectError with code + message', async () => {
    const fetchImpl = mockJsonFetch(400, {
      code: 'invalid_argument',
      message: 'session not found',
    });
    const engine = new ConnectWebEngine({
      baseUrl: BASE_URL,
      token: TOKEN,
      sessionId: 'bad-sess',
      fetch: fetchImpl,
    });
    await expect(engine.sessionSave()).rejects.toThrowError(ConnectError);
  });

  test('ConnectError carries code + message', async () => {
    const fetchImpl = mockJsonFetch(400, {
      code: 'permission_denied',
      message: 'token expired',
    });
    const engine = new ConnectWebEngine({
      baseUrl: BASE_URL,
      token: TOKEN,
      sessionId: 'bad-sess',
      fetch: fetchImpl,
    });
    try {
      await engine.sessionSave();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe('permission_denied');
      expect((err as Error).message).toContain('token expired');
    }
  });

  test('non-JSON error body falls back to HTTP code', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('not json', { status: 503, statusText: 'Service Unavailable' }),
      ) as unknown as typeof fetch;
    const engine = new ConnectWebEngine({
      baseUrl: BASE_URL,
      token: TOKEN,
      sessionId: 'x',
      fetch: fetchImpl,
    });
    await expect(engine.sessionSave()).rejects.toThrowError(ConnectError);
  });
});

describe('ConnectWebEngine — sessionGenerate', () => {
  test('sends all generation options and decodes diagnostics', async () => {
    const fetchImpl = mockJsonFetch(200, {
      filesWritten: ['main.tf', 'variables.tf'],
      files: {},
      diagnostics: [
        {
          severity: 'DIAGNOSTIC_SEVERITY_WARNING',
          message: 'a warning',
          file: 'main.tf',
          line: 3,
        },
      ],
    });
    const engine = new ConnectWebEngine({
      baseUrl: BASE_URL,
      token: TOKEN,
      sessionId: 'gen-sess',
      fetch: fetchImpl,
    });

    const result = await engine.sessionGenerate('/tmp/out', {
      dry_run: false,
      format: true,
      validate: true,
      overwrite: true,
    });

    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    // Fields equal to their proto defaults (e.g. dry_run: false) are omitted
    // from the JSON wire format — that's standard protojson behaviour.
    expect(JSON.parse(init.body)).toEqual({
      sessionId: 'gen-sess',
      outputDir: '/tmp/out',
      format: true,
      validate: true,
      overwrite: true,
    });
    expect(result.files_written).toEqual(['main.tf', 'variables.tf']);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ severity: 'warning', message: 'a warning' });
  });
});

// ── Connect-JSON streaming frame parser ──
//
// We test the parser via the public Subscribe path by feeding a mocked
// ReadableStream with pre-built frame bytes.

function buildFrame(payloadObj: unknown, endOfStream = false): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(payloadObj));
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = endOfStream ? 0x01 : 0x00;
  const length = payload.length;
  frame[1] = (length >>> 24) & 0xff;
  frame[2] = (length >>> 16) & 0xff;
  frame[3] = (length >>> 8) & 0xff;
  frame[4] = length & 0xff;
  frame.set(payload, 5);
  return frame;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe('ConnectWebEngine — Subscribe stream', () => {
  test('emits stateUpdated event from state_updated frame', async () => {
    const eventFrame = buildFrame({
      stateUpdated: {
        view: {
          moduleName: 'flow-story',
          nodes: [],
          edges: [],
          errors: [],
          canUndo: false,
          canRedo: false,
          isDirty: false,
          groups: [],
        },
      },
    });
    const endFrame = buildFrame({}, true);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(concatBytes(eventFrame, endFrame));
        controller.close();
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(stream, { status: 200, statusText: 'OK' }),
      ) as unknown as typeof fetch;

    const engine = new ConnectWebEngine({
      baseUrl: BASE_URL,
      token: TOKEN,
      sessionId: 'stream-sess',
      fetch: fetchImpl,
    });

    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));

    const unsubscribe = engine.startSubscribe();
    // Let the async loop drain.
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubscribe();

    const stateUpdated = events.find((e) => e.type === 'stateUpdated');
    expect(stateUpdated).toBeDefined();
    expect(stateUpdated?.type === 'stateUpdated' && stateUpdated.view.module_name).toBe(
      'flow-story',
    );
  });

  test('emits generateSuccess event from generate_success frame', async () => {
    const eventFrame = buildFrame({
      generateSuccess: { filesWritten: ['main.tf'], files: {} },
    });
    const endFrame = buildFrame({}, true);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(concatBytes(eventFrame, endFrame));
        controller.close();
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(stream, { status: 200, statusText: 'OK' }),
      ) as unknown as typeof fetch;

    const engine = new ConnectWebEngine({
      baseUrl: BASE_URL,
      token: TOKEN,
      sessionId: 'stream-sess',
      fetch: fetchImpl,
    });

    const events: EngineEvent[] = [];
    engine.onEvent((e) => events.push(e));

    const unsubscribe = engine.startSubscribe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    unsubscribe();

    const success = events.find((e) => e.type === 'generateSuccess');
    expect(success).toBeDefined();
    expect(success?.type === 'generateSuccess' && success.files).toEqual(['main.tf']);
  });
});
