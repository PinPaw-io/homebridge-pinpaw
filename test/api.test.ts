import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PinPawApi, PinPawApiError, PinPawAuthError, looksLikeToken } from '../src/api.js';

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch stand-in that records calls and replays a scripted response. */
function stubFetch(responder: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('looksLikeToken', () => {
  it('accepts the PinPaw prefix and rejects anything else', () => {
    assert.equal(looksLikeToken('ppw_pat_x'), true);
    assert.equal(looksLikeToken('ppw_pa'), false);
    assert.equal(looksLikeToken(''), false);
  });
});

describe('PinPawApi', () => {
  it('sends the bearer token and accepts JSON', async () => {
    const { impl, calls } = stubFetch(() => json([]));
    await new PinPawApi('https://api.pinpaw.io', 'ppw_pat_abc', impl).getPets();

    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer ppw_pat_abc');
    assert.equal(headers.Accept, 'application/json');
  });

  it('strips a trailing slash from the base URL', async () => {
    const { impl, calls } = stubFetch(() => json([]));
    await new PinPawApi('https://api.pinpaw.io///', 'ppw_pat_abc', impl).getPets();
    assert.equal(calls[0]!.url, 'https://api.pinpaw.io/api/pets');
  });

  it('returns the pet list', async () => {
    const { impl } = stubFetch(() => json([{ id: 1 }, { id: 2 }]));
    const pets = await new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets();
    assert.equal(pets.length, 2);
  });

  it('drops entries without a numeric id', async () => {
    const { impl } = stubFetch(() => json([{ id: 1 }, { name: 'no id' }, { id: 'seven' }]));
    const pets = await new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets();
    assert.deepEqual(pets.map((p) => p.id), [1]);
  });

  it('rejects a non-array pets payload', async () => {
    const { impl } = stubFetch(() => json({ pets: [] }));
    await assert.rejects(
      () => new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets(),
      PinPawApiError,
    );
  });

  it('raises an auth error on 401', async () => {
    const { impl } = stubFetch(() => new Response('', { status: 401 }));
    await assert.rejects(
      () => new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets(),
      PinPawAuthError,
    );
  });

  it('raises an auth error on 403', async () => {
    const { impl } = stubFetch(() => new Response('', { status: 403 }));
    await assert.rejects(
      () => new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets(),
      PinPawAuthError,
    );
  });

  it('raises a plain api error on 500, not an auth error', async () => {
    const { impl } = stubFetch(() => new Response('', { status: 500 }));
    await assert.rejects(
      () => new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets(),
      (error: unknown) => error instanceof PinPawApiError && !(error instanceof PinPawAuthError),
    );
  });

  it('wraps a transport failure', async () => {
    const { impl } = stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    await assert.rejects(
      () => new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets(),
      (error: unknown) => error instanceof PinPawApiError && /ECONNREFUSED/.test((error as Error).message),
    );
  });

  it('reports malformed JSON', async () => {
    const { impl } = stubFetch(() => new Response('not json{', { status: 200 }));
    await assert.rejects(
      () => new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets(),
      (error: unknown) => error instanceof PinPawApiError && /malformed JSON/.test((error as Error).message),
    );
  });

  it('puts the tracking interval on the right path with the right body', async () => {
    const { impl, calls } = stubFetch(() => new Response(null, { status: 204 }));
    await new PinPawApi('https://x.test', 'ppw_pat_abc', impl).setTrackingInterval(7, 120);

    assert.equal(calls[0]!.url, 'https://x.test/api/pets/7/tracking-interval');
    assert.equal(calls[0]!.init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { trackingInterval: 120 });
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('does not set a content type on a bodyless request', async () => {
    const { impl, calls } = stubFetch(() => json([]));
    await new PinPawApi('https://x.test', 'ppw_pat_abc', impl).getPets();
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers['Content-Type'], undefined);
  });
});
