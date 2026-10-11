import type { EngineCredential } from '@lace-cloud/host';
import { describe, expect, test, vi } from 'vitest';
import { apiTransport, candidatesUrl, RefusedPathError } from '../api-transport';

const SIGNED_IN: EngineCredential = { apiKey: 'lace_key_1', apiBaseUrl: 'https://lace.example' };
const SIGNED_OUT: EngineCredential = { apiKey: undefined, apiBaseUrl: 'https://lace.example' };

// The transport over an engine holding `holds()` at each read, and a fetch
// that answers `answer` and records each request.
function setUp(holds: () => EngineCredential, answer = () => Response.json({ ok: true })) {
  const credential = vi.fn(async () => holds());
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => answer());
  return { transport: apiTransport({ credential, fetch }), credential, fetch };
}

const RANK = { request: 'remove the database', statement: 'delete db', candidates: [] };

// A request's `init` as chat-core gives it, with the signal it aborts when it
// gives the request up.
const posting = (
  body: unknown,
  signal = new AbortController().signal,
): { method: 'POST'; body: unknown; signal: AbortSignal } => ({ method: 'POST', body, signal });

describe("the transport to Lace's API", () => {
  test('posts the body as JSON to the API the engine names, with its key as the bearer and the call’s signal', async () => {
    const { transport, fetch } = setUp(() => SIGNED_IN);
    const { signal } = new AbortController();

    await transport('/api/v1/candidates/rank', posting(RANK, signal));

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://lace.example/api/v1/candidates/rank');
    expect(init).toEqual({
      method: 'POST',
      headers: { authorization: 'Bearer lace_key_1', 'content-type': 'application/json' },
      body: JSON.stringify(RANK),
      signal,
    });
    expect(init?.signal).toBe(signal);
  });

  test('a request chat-core gives up rejects as the fetch it aborted rejects', async () => {
    const aborted = new DOMException('This operation was aborted', 'AbortError');
    const credential = async () => SIGNED_IN;
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(aborted));
        }),
    );
    const transport = apiTransport({ credential, fetch });
    const giving = new AbortController();

    const reply = transport('/api/v1/candidates/rank', posting(RANK, giving.signal));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    giving.abort();
    await expect(reply).rejects.toBe(aborted);
  });

  test("returns the response's status and its JSON body as they came", async () => {
    const body = { error: { code: 'ranking_unavailable' } };
    const { transport } = setUp(
      () => SIGNED_IN,
      () => Response.json(body, { status: 503 }),
    );

    expect(await transport('/api/v1/candidates/rank', posting(RANK))).toEqual({
      status: 503,
      body,
    });
  });

  test('reads the credential for every request, so a sign-out, a sign-in or another account shows at the next', async () => {
    let holds = SIGNED_IN;
    const { transport, credential, fetch } = setUp(() => holds);
    const post = () => transport('/api/v1/candidates/decisions', posting({}));

    await post();
    holds = SIGNED_OUT;
    expect(await post()).toEqual({ carried: false });
    holds = { apiKey: 'lace_key_2', apiBaseUrl: 'https://eu.lace.example' };
    await post();

    expect(credential).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.headers])).toEqual([
      [
        'https://lace.example/api/v1/candidates/decisions',
        { authorization: 'Bearer lace_key_1', 'content-type': 'application/json' },
      ],
      [
        'https://eu.lace.example/api/v1/candidates/decisions',
        { authorization: 'Bearer lace_key_2', 'content-type': 'application/json' },
      ],
    ]);
  });

  test('for a developer who is signed out, carries nothing and makes no request', async () => {
    const { transport, fetch } = setUp(() => SIGNED_OUT);

    expect(await transport('/api/v1/candidates/rank', posting(RANK))).toEqual({ carried: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    '/api/v1/candidates/..',
    '/api/v1/candidates/../../v1/tokens',
    '/api/v1/candidates/%2e%2e/%2E%2E/v1/tokens',
    '/api/v1/candidates/..%2f..%2fv1/tokens',
  ] as const)('refuses %s, which leaves the candidates routes, and makes no request', async (path) => {
    const { transport, fetch } = setUp(() => SIGNED_IN);

    await expect(transport(path, posting({}))).rejects.toBeInstanceOf(RefusedPathError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test.each([
    ['a 204 with no body', () => new Response(null, { status: 204 })],
    [
      'a 405 page',
      () =>
        new Response('<html>Method Not Allowed</html>', {
          status: 405,
          headers: { 'content-type': 'text/html' },
        }),
    ],
  ])('returns %s as it came, with no body', async (_reply, answer) => {
    const { transport } = setUp(() => SIGNED_IN, answer);
    const reply = transport('/api/v1/candidates/decisions', posting({}));
    await expect(reply).resolves.toEqual({ status: answer().status, body: undefined });
  });
});

describe('the URL a path reaches', () => {
  test.each([
    [
      'https://lace.example',
      '/api/v1/candidates/rank',
      'https://lace.example/api/v1/candidates/rank',
    ],
    [
      'https://lace.example/',
      '/api/v1/candidates/rank',
      'https://lace.example/api/v1/candidates/rank',
    ],
    [
      'https://lace.example/v2/',
      '/api/v1/candidates/rank',
      'https://lace.example/api/v1/candidates/rank',
    ],
    [
      'https://lace.example',
      'api/v1/candidates/rank',
      'https://lace.example/api/v1/candidates/rank',
    ],
    [
      'https://lace.example',
      '/api/v1/candidates/decisions/d-1/outcomes',
      'https://lace.example/api/v1/candidates/decisions/d-1/outcomes',
    ],
  ])('on %s, %s is %s', (base, path, reached) => {
    expect(candidatesUrl(path, base)?.href).toBe(reached);
  });

  test.each([
    [
      'a relative path that resolves under a base with a path',
      'https://lace.example/v2/',
      'api/v1/candidates/rank',
    ],
    [
      'a protocol-relative URL',
      'https://lace.example',
      '//elsewhere.example/api/v1/candidates/rank',
    ],
    ['an absolute URL', 'https://lace.example', 'https://elsewhere.example/api/v1/candidates/rank'],
    ['dot segments', 'https://lace.example', '/api/v1/candidates/../../v1/tokens'],
    ['encoded dot segments', 'https://lace.example', '/api/v1/candidates/%2e%2e/%2e%2e/v1/tokens'],
    [
      'encoded slashes, lower case',
      'https://lace.example',
      '/api/v1/candidates/..%2f..%2fv1%2ftokens',
    ],
    [
      'encoded slashes, upper case',
      'https://lace.example',
      '/api/v1/candidates/..%2F..%2Fv1%2Ftokens',
    ],
    ['the candidates path encoded whole', 'https://lace.example', '/api%2Fv1%2Fcandidates%2Frank'],
    ['another route', 'https://lace.example', '/api/v1/tokens'],
    ['a path that does not decode', 'https://lace.example', '/api/v1/candidates/%E0%A4%A'],
  ])('refuses %s', (_case, base, path) => {
    expect(candidatesUrl(path, base)).toBeUndefined();
  });
});
