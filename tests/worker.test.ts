import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createWorker, type Env } from '../src/server/worker.js';
import { sqliteD1 } from './sqlite-d1.js';

const schema = (
  await Promise.all(
    ['0001_initial.sql', '0002_integrity_and_quotas.sql'].map((name) =>
      readFile(new URL(`../src/server/migrations/${name}`, import.meta.url), 'utf8'),
    ),
  )
).join('\n');
const context = { waitUntil: (promise: Promise<unknown>) => void promise.catch(() => undefined) };

async function fixture(env: Omit<Partial<Env>, 'DB'> = {}) {
  const DB = await sqliteD1(schema);
  const worker = createWorker();
  const request = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`http://localhost${path}`, init), { DB, ...env }, context);
  return { DB, request };
}

async function credentials(request: (path: string, init?: RequestInit) => Promise<Response>) {
  const create = await request('/api/rooms', {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  const host = (await create.json()) as {
    roomCode: string;
    participantId: string;
    writeToken: string;
  };
  const join = await request(`/api/rooms/${host.roomCode}/join`, {
    method: 'POST',
    body: '{}',
    headers: { 'content-type': 'application/json' },
  });
  const guest = (await join.json()) as { participantId: string; writeToken: string };
  const auth = (identity: { participantId: string; writeToken: string }) => ({
    authorization: `Bearer ${identity.participantId}.${identity.writeToken}`,
    'content-type': 'application/json',
  });
  return { host, guest, auth };
}

describe('worker room integration', () => {
  it('falls back to the Vite client entry for hosted browser routes', async () => {
    const DB = await sqliteD1(schema);
    const requested: string[] = [];
    const worker = createWorker();
    const response = await worker.fetch(
      new Request('https://site.example/admin'),
      {
        DB,
        ASSETS: {
          fetch: (request) => {
            requested.push(new URL(request.url).pathname);
            return Promise.resolve(
              requested.length === 1
                ? new Response('missing', { status: 404 })
                : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
            );
          },
        },
      },
      context,
    );
    expect(requested).toEqual(['/admin', '/']);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('reports trusted production sign-in state without exposing the identity', async () => {
    const DB = await sqliteD1(schema);
    const worker = createWorker();
    const response = await worker.fetch(
      new Request('https://site.example/api/session', {
        headers: { 'oai-authenticated-user-email': 'owner@example.test' },
      }),
      { DB, ENVIRONMENT: 'production' },
      context,
    );
    expect(await response.json()).toEqual({ authenticated: true });
  });

  it('requires matching manifest acknowledgements before allowing scoped signaling', async () => {
    const { request } = await fixture();
    const { host, guest, auth } = await credentials(request);
    for (const peer of [host, guest]) {
      expect(
        (
          await request(`/api/rooms/${host.roomCode}/capabilities`, {
            method: 'POST',
            headers: auth(peer),
            body: JSON.stringify({
              endpoints: [
                {
                  id: 'stun-udp-0',
                  urls: ['stun:stun.cloudflare.com:3478'],
                  kind: 'stun',
                  transports: ['udp'],
                },
              ],
            }),
          })
        ).status,
      ).toBe(200);
    }
    const created = await request(`/api/rooms/${host.roomCode}/attempts`, {
      method: 'POST',
      headers: auth(host),
      body: '{}',
    });
    expect(created.status).toBe(201);
    const attempt = (await created.json()) as {
      id: string;
      generation: number;
      manifest: Array<Record<string, unknown>>;
    };
    const signalUrl = `/api/signals/${attempt.id}?probe=prb_abcdefghijkl&generation=${attempt.generation}`;
    expect(
      (
        await request(signalUrl, {
          method: 'GET',
          headers: auth(host),
        })
      ).status,
    ).toBe(409);
    for (const peer of [host, guest]) {
      expect(
        (
          await request(`/api/rooms/${host.roomCode}/attempts/${attempt.id}/ack`, {
            method: 'POST',
            headers: auth(peer),
            body: JSON.stringify({ manifest: attempt.manifest }),
          })
        ).status,
      ).toBe(200);
    }
    expect((await request(signalUrl, { method: 'GET', headers: auth(host) })).status).toBe(200);
    const retried = await request(`/api/rooms/${host.roomCode}/retry`, {
      method: 'POST',
      headers: auth(guest),
      body: JSON.stringify({ previousAttemptId: attempt.id }),
    });
    expect(retried.status).toBe(201);
    expect((await request(signalUrl, { method: 'GET', headers: auth(host) })).status).toBe(409);
  });

  it('distinguishes invalid capability payloads from missing room authorization', async () => {
    const { request } = await fixture();
    const { host, auth } = await credentials(request);
    const path = `/api/rooms/${host.roomCode}/capabilities`;
    const unauthorized = await request(path, {
      method: 'POST',
      body: JSON.stringify({ endpoints: [] }),
    });
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.json()).toEqual({ error: 'forbidden' });

    const malformed = await request(path, {
      method: 'POST',
      headers: auth(host),
      body: JSON.stringify({ endpoints: [{ id: 'not-an-endpoint' }] }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid capabilities' });
  });

  it('revokes a departed guest before admitting and authenticating a replacement', async () => {
    const { request } = await fixture();
    const { host, guest, auth } = await credentials(request);
    expect(
      (
        await request(`/api/rooms/${host.roomCode}/leave`, {
          method: 'POST',
          headers: auth(guest),
          body: '{}',
        })
      ).status,
    ).toBe(200);
    const replacementResponse = await request(`/api/rooms/${host.roomCode}/join`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(replacementResponse.status).toBe(200);
    const replacement = (await replacementResponse.json()) as {
      participantId: string;
      writeToken: string;
    };
    expect((await request(`/api/rooms/${host.roomCode}`, { headers: auth(guest) })).status).toBe(
      403,
    );
    expect(
      (await request(`/api/rooms/${host.roomCode}`, { headers: auth(replacement) })).status,
    ).toBe(200);
  });

  it('denies event writes by a different scoped participant and owner reads in production', async () => {
    const { request } = await fixture();
    const { host, guest, auth } = await credentials(request);
    expect(
      (
        await request('/api/runs', {
          method: 'POST',
          headers: auth(host),
          body: JSON.stringify({ runId: 'run_abcdefghijkl' }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request('/api/runs/run_abcdefghijkl/events', {
          method: 'POST',
          headers: auth(guest),
          body: JSON.stringify({ events: [] }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/admin/attempts', {
          headers: { 'x-dev-identity': 'owner' },
        })
      ).status,
    ).toBe(403);
  });
  it('allows only an explicit loopback development owner and fails closed otherwise', async () => {
    const DB = await sqliteD1(schema);
    const worker = createWorker();
    const call = (host: string, env: Pick<Env, 'ENVIRONMENT' | 'OWNER_ID'>, identity?: string) =>
      worker.fetch(
        new Request(`http://${host}/api/admin/attempts`, {
          headers: identity ? { 'x-dev-identity': identity } : {},
        }),
        { DB, ...env },
        context,
      );
    expect(
      (await call('localhost', { ENVIRONMENT: 'development', OWNER_ID: 'owner' }, 'owner')).status,
    ).toBe(200);
    expect(
      (await call('localhost', { ENVIRONMENT: 'development', OWNER_ID: 'owner' })).status,
    ).toBe(403);
    expect(
      (await call('example.test', { ENVIRONMENT: 'development', OWNER_ID: 'owner' }, 'owner'))
        .status,
    ).toBe(403);
    expect(
      (await call('localhost', { ENVIRONMENT: 'production', OWNER_ID: 'owner' }, 'owner')).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(
          new Request('https://site.example/api/admin/attempts', {
            headers: { 'oai-authenticated-user-id': 'owner' },
          }),
          { DB, ENVIRONMENT: 'production', OWNER_ID: 'owner' },
          context,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          new Request('https://site.example/api/admin/export', {
            headers: { 'oai-authenticated-user-id': 'not-owner' },
          }),
          { DB, ENVIRONMENT: 'production', OWNER_ID: 'owner' },
          context,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(
          new Request('https://site.example/api/admin/attempts', {
            headers: { 'oai-authenticated-user-email': 'owner@example.test' },
          }),
          { DB, ENVIRONMENT: 'production', OWNER_ID: 'owner@example.test' },
          context,
        )
      ).status,
    ).toBe(200);
    expect((await call('localhost', { ENVIRONMENT: 'production' }, 'owner')).status).toBe(403);
  });

  it('denies guessed participant write tokens', async () => {
    const { request } = await fixture();
    const created = await request('/api/rooms', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    const room = (await created.json()) as { roomCode: string; participantId: string };
    expect(
      (
        await request(`/api/rooms/${room.roomCode}`, {
          headers: { authorization: `Bearer ${room.participantId}.guessed-token` },
        })
      ).status,
    ).toBe(403);
  });

  it('requires scoped participant authorization before TURN credential handling', async () => {
    const { request } = await fixture();
    const response = await request('/api/rooms/ABCDEFGH/turn-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode: 'valid-access-code' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
  });

  it('rejects TURN credential issuance after the room expires', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { DB, request } = await fixture({
        XIRSYS_IDENT: 'test-ident',
        XIRSYS_SECRET: 'test-secret',
        XIRSYS_CHANNEL: 'test-channel',
        DIAGNOSTIC_ACCESS_CODE: 'A7B9C2',
      });
      const { host, auth } = await credentials(request);
      await DB.prepare('UPDATE rooms SET expires_at=0 WHERE code=?').bind(host.roomCode).run();
      const response = await request(`/api/rooms/${host.roomCode}/turn-credentials`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ accessCode: 'A7B9C2' }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails closed for missing Xirsys configuration and rejects malformed or invalid access codes', async () => {
    const { request: unconfigured } = await fixture();
    const { host, auth } = await credentials(unconfigured);
    const path = `/api/rooms/${host.roomCode}/turn-credentials`;
    const unavailable = await unconfigured(path, {
      method: 'POST',
      headers: auth(host),
      body: JSON.stringify({ accessCode: 'valid-access-code' }),
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: 'TURN credential service is not configured',
    });

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { request } = await fixture({
        XIRSYS_IDENT: 'test-ident',
        XIRSYS_SECRET: 'test-secret',
        XIRSYS_CHANNEL: 'test-channel',
        DIAGNOSTIC_ACCESS_CODE: 'valid-access-code',
      });
      const room = await credentials(request);
      const malformed = await request(`/api/rooms/${room.host.roomCode}/turn-credentials`, {
        method: 'POST',
        headers: room.auth(room.host),
        body: JSON.stringify({ accessCode: 1 }),
      });
      expect(malformed.status).toBe(400);
      const tooShort = await request(`/api/rooms/${room.host.roomCode}/turn-credentials`, {
        method: 'POST',
        headers: room.auth(room.host),
        body: JSON.stringify({ accessCode: 'A7B9C' }),
      });
      expect(tooShort.status).toBe(400);
      const invalid = await request(`/api/rooms/${room.host.roomCode}/turn-credentials`, {
        method: 'POST',
        headers: room.auth(room.host),
        body: JSON.stringify({ accessCode: 'wrong-access-code' }),
      });
      expect(invalid.status).toBe(403);
      expect(await invalid.json()).toEqual({ error: 'The TURN relay access code is incorrect' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('normalizes temporary Xirsys TURN credentials without exposing configuration', async () => {
    let upstreamRequest: { url: string; init: RequestInit | undefined } | undefined;
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      upstreamRequest = {
        url: typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url,
        init,
      };
      return Promise.resolve(
        Response.json({
          v: {
            iceServers: [
              {
                urls: [
                  'turn:relay.example.test:3478?transport=udp',
                  'turns:relay.example.test:443?transport=tcp',
                ],
                username: 'temporary-user',
                credential: 'temporary-credential',
              },
              {
                url: 'turn:legacy.example.test:3478?transport=udp',
                username: 'temporary-user',
                credential: 'temporary-credential',
              },
              {
                urls: 'stun:stun.example.test:3478',
              },
            ],
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { request } = await fixture({
        XIRSYS_IDENT: 'test-ident',
        XIRSYS_SECRET: 'test-secret',
        XIRSYS_CHANNEL: '/account/channel with space/',
        DIAGNOSTIC_ACCESS_CODE: '  A7B9C2\n',
      });
      const { host, auth } = await credentials(request);
      const response = await request(`/api/rooms/${host.roomCode}/turn-credentials`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ accessCode: '\tA7B9C2 ' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        iceServers: [
          {
            urls: ['turn:relay.example.test:3478?transport=udp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
          {
            urls: ['turns:relay.example.test:443?transport=tcp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
          {
            urls: ['turn:legacy.example.test:3478?transport=udp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
        ],
      });
      expect(upstreamRequest?.url).toBe(
        'https://global.xirsys.net/_turn/account/channel%20with%20space',
      );
      expect(upstreamRequest?.init?.method).toBe('PUT');
      expect(upstreamRequest?.init?.body).toBe('{"format":"urls"}');
      expect(new Headers(upstreamRequest?.init?.headers).get('content-type')).toBe(
        'application/json',
      );
      expect(new Headers(upstreamRequest?.init?.headers).get('authorization')).toBe(
        'Basic dGVzdC1pZGVudDp0ZXN0LXNlY3JldA==',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('normalizes the standard single-object Xirsys response and filters STUN URLs', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          s: 'ok',
          v: {
            iceServers: {
              urls: [
                'stun:stun.example.test:3478',
                'turn:relay.example.test:3478?transport=udp',
                'turn:relay.example.test:3478?transport=tcp',
                'turn:relay.example.test:80?transport=udp',
                'turn:relay.example.test:80?transport=tcp',
                'turns:relay.example.test:443?transport=tcp',
                'turns:relay.example.test:5349?transport=tcp',
              ],
              username: 'temporary-user',
              credential: 'temporary-credential',
            },
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { request } = await fixture({
        XIRSYS_IDENT: 'test-ident',
        XIRSYS_SECRET: 'test-secret',
        XIRSYS_CHANNEL: 'test-channel',
        DIAGNOSTIC_ACCESS_CODE: 'valid-access-code',
      });
      const { host, auth } = await credentials(request);
      const response = await request(`/api/rooms/${host.roomCode}/turn-credentials`, {
        method: 'POST',
        headers: auth(host),
        body: JSON.stringify({ accessCode: 'valid-access-code' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        iceServers: [
          {
            urls: ['turn:relay.example.test:3478?transport=udp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
          {
            urls: ['turn:relay.example.test:3478?transport=tcp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
          {
            urls: ['turn:relay.example.test:80?transport=udp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
          {
            urls: ['turn:relay.example.test:80?transport=tcp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
          {
            urls: ['turns:relay.example.test:443?transport=tcp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
          {
            urls: ['turns:relay.example.test:5349?transport=tcp'],
            username: 'temporary-user',
            credential: 'temporary-credential',
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not expose malformed, failed, or timed-out Xirsys upstream responses', async () => {
    const configuration = {
      XIRSYS_IDENT: 'test-ident',
      XIRSYS_SECRET: 'test-secret',
      XIRSYS_CHANNEL: 'test-channel',
      DIAGNOSTIC_ACCESS_CODE: 'valid-access-code',
    };
    const cases: Array<{
      upstream: () => Promise<Response>;
      expectedStatus: number;
      expectedError: string;
    }> = [
      {
        upstream: () => Promise.resolve(Response.json({ v: { iceServers: [{}] } })),
        expectedStatus: 502,
        expectedError: 'TURN credential service unavailable',
      },
      {
        upstream: () =>
          Promise.resolve(
            Response.json({
              v: {
                iceServers: {
                  urls: 'turn:relay.example.test:3478?transport=udp',
                  username: 'temporary-user',
                },
              },
            }),
          ),
        expectedStatus: 502,
        expectedError: 'TURN credential service unavailable',
      },
      {
        upstream: () =>
          Promise.resolve(
            Response.json({
              s: 'error',
              v: {
                iceServers: {
                  urls: 'turn:relay.example.test:3478?transport=udp',
                  username: 'temporary-user',
                  credential: 'temporary-credential',
                },
              },
              detail: 'provider-only error payload',
            }),
          ),
        expectedStatus: 502,
        expectedError: 'TURN credential service unavailable',
      },
      {
        upstream: () => Promise.resolve(new Response('provider error', { status: 500 })),
        expectedStatus: 502,
        expectedError: 'TURN credential service unavailable',
      },
      {
        upstream: () => Promise.resolve(new Response('provider rejection', { status: 403 })),
        expectedStatus: 502,
        expectedError: 'TURN provider rejected its API credentials or channel',
      },
      {
        upstream: () => Promise.reject(new DOMException('timed out', 'TimeoutError')),
        expectedStatus: 504,
        expectedError: 'TURN credential service timed out',
      },
    ];
    for (const testCase of cases) {
      vi.stubGlobal('fetch', vi.fn(testCase.upstream));
      try {
        const { request } = await fixture(configuration);
        const { host, auth } = await credentials(request);
        const response = await request(`/api/rooms/${host.roomCode}/turn-credentials`, {
          method: 'POST',
          headers: auth(host),
          body: JSON.stringify({ accessCode: 'valid-access-code' }),
        });
        expect(response.status).toBe(testCase.expectedStatus);
        expect(await response.json()).toEqual({ error: testCase.expectedError });
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});
