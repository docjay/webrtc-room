import { describe, expect, it } from 'vitest';
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

async function fixture() {
  const DB = await sqliteD1(schema);
  const worker = createWorker();
  const request = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`http://localhost${path}`, init), { DB }, context);
  return { request };
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
                  urls: ['stun:stun.l.google.com:19302'],
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
});
