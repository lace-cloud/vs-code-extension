// The canvas tool sets' `Transport`: chat-core's one port to Lace's API,
// through which its tools ask Lace's ranking and report each decision and
// what happened to it next. chat-core never sees a credential; this
// transport attaches the developer's own to each request.
//
// Each request is one POST of its body as JSON to the path resolved against
// the API the engine's own commands call (`new URL(path, apiBaseUrl)`, as the
// CLI resolves its own), with the key the engine holds as the bearer. The
// credential is read from the engine for every request and never kept, so
// a sign-in, a sign-out or another account takes effect at the next one.
// Only Lace's candidates routes are reached: a URL on another origin, or one
// whose path is not under them once dot segments and encoded slashes are
// resolved, is refused and nothing is sent. A developer who is signed out
// holds no key, and no request is made: the transport answers that it
// carried nothing (`{carried: false}`), and chat-core's change call then
// composes exactly as with no transport. The request carries the signal
// chat-core aborts when it gives the request up; its timing is chat-core's,
// and a request that fails or is aborted rejects as `fetch` rejects. The
// reply goes back as it came: its status, and its body parsed when it is
// JSON (none when it is not, as a 204 or an HTML error page).
import type { Transport } from '@lace-cloud/chat-core';
import type { EngineCredential } from '@lace-cloud/host';

export type ApiTransportPorts = {
  // The credential the engine holds now.
  credential: () => Promise<EngineCredential>;
  fetch: typeof fetch;
};

const CANDIDATES = '/api/v1/candidates/';

// `pathname` with its percent-encoded characters decoded and its dot
// segments resolved, as a server reading the path would see it; undefined
// when it does not decode.
function resolved(pathname: string, origin: string): string | undefined {
  try {
    return new URL(decodeURIComponent(pathname), origin).pathname;
  } catch {
    return undefined;
  }
}

// The URL `path` reaches on the API at `apiBaseUrl`, when it is one of
// Lace's candidates routes: on the API's own origin, and under
// `/api/v1/candidates/` as the URL resolves its path and as a server
// decoding it would.
export function candidatesUrl(path: string, apiBaseUrl: string): URL | undefined {
  const base = new URL(apiBaseUrl);
  const url = new URL(path, base);
  const under = (pathname: string | undefined) => pathname?.startsWith(CANDIDATES) === true;
  return url.origin === base.origin &&
    under(url.pathname) &&
    under(resolved(url.pathname, url.origin))
    ? url
    : undefined;
}

// A path the transport does not reach.
export class RefusedPathError extends Error {
  constructor(readonly path: string) {
    super(`Lace's tools reach only ${CANDIDATES}*, not ${path}`);
  }
}

// A reply's body: its JSON, or none when it holds none.
async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function apiTransport({ credential, fetch }: ApiTransportPorts): Transport {
  return async (path, init) => {
    const { apiKey, apiBaseUrl } = await credential();
    const url = candidatesUrl(path, apiBaseUrl);
    if (url === undefined) throw new RefusedPathError(path);
    if (apiKey === undefined) return { carried: false };
    const response = await fetch(url, {
      method: init.method,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(init.body),
      signal: init.signal,
    });
    return { status: response.status, body: await bodyOf(response) };
  };
}
