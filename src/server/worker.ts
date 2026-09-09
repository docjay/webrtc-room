import { z } from 'zod';
import {
  attemptIdSchema,
  diagnosticEventSchema,
  participantIdSchema,
  probeIdSchema,
  redact,
  roomCodeSchema,
  runIdSchema,
  TURN_ACCESS_CODE_MIN_LENGTH,
  buildProfiles,
} from '../shared/domain.js';
import { requestXirsysTurnCredentials, XirsysError } from './xirsys.js';
import {
  DevelopmentIdentityAdapter,
  ProductionIdentityAdapter,
  requireOwner,
  type IdentityAdapter,
} from './auth.js';
import { Repository } from './repository.js';
import type { D1Database } from './db/types.js';
export interface Env {
  DB: D1Database;
  OWNER_ID?: string;
  ENVIRONMENT?: string;
  XIRSYS_IDENT?: string;
  XIRSYS_SECRET?: string;
  XIRSYS_CHANNEL?: string;
  DIAGNOSTIC_ACCESS_CODE?: string;
  /** Sites/Workers static asset binding, injected by the hosting platform. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}
type Dependencies = { identity?: IdentityAdapter; repository?: (db: D1Database) => Repository };
const manifestSchema = z
  .array(z.object({ id: z.string().min(1).max(100) }).passthrough())
  .min(1)
  .max(200);
const endpointsSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^(stun|turn)-(udp|tcp|tls)-\d+$/),
        urls: z.array(z.string().max(256)).min(1).max(3),
        kind: z.enum(['stun', 'turn']),
        transports: z
          .array(z.enum(['udp', 'tcp', 'tls']))
          .min(1)
          .max(3),
      })
      .strict(),
  )
  .max(9);
const turnCredentialsRequestSchema = z
  .object({ accessCode: z.string().trim().min(TURN_ACCESS_CODE_MIN_LENGTH).max(256) })
  .strict();
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const token = () => crypto.randomUUID().replaceAll('-', '');
async function sha(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function accessCodeMatches(supplied: string, configured: string): Promise<boolean> {
  const encode = new TextEncoder();
  const [suppliedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(supplied)),
    crypto.subtle.digest('SHA-256', encode.encode(configured)),
  ]);
  const left = new Uint8Array(suppliedHash);
  const right = new Uint8Array(configuredHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
async function body(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 128_000) throw new Error('request too large');
  return request.json();
}
function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((n) => chars[n % chars.length])
    .join('');
}
export function createWorker(deps: Dependencies = {}) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      try {
        const url = new URL(request.url);
        const repo = deps.repository?.(env.DB) ?? new Repository(env.DB);
        // Cleanup is opportunistic: it never relies on a scheduled Worker invocation.
        ctx.waitUntil(repo.cleanup());
        const production = env.ENVIRONMENT === 'production';
        const identity =
          deps.identity ??
          (production ? new ProductionIdentityAdapter() : new DevelopmentIdentityAdapter(true));
        if (request.method === 'GET' && url.pathname === '/api/health')
          return json({ ok: true, persistence: 'D1' });
        if (request.method === 'GET' && url.pathname === '/api/session')
          return json({ authenticated: Boolean(await identity.identity(request)) });
        if (request.method === 'POST' && url.pathname === '/api/rooms') {
          const parsed = z
            .object({})
            .strict()
            .safeParse(await body(request));
          if (!parsed.success) return json({ error: 'invalid request' }, 400);
          const participant = `pt_${token()}`,
            writeToken = token(),
            room = code();
          await repo.createRoom(room, participant, await sha(writeToken));
          return json({ roomCode: room, participantId: participant, writeToken }, 201);
        }
        const join = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
        if (request.method === 'POST' && join) {
          const room = roomCodeSchema.safeParse(join[1]);
          if (!room.success) return json({ error: 'invalid room' }, 400);
          const participant = `pt_${token()}`,
            writeToken = token(),
            outcome = await repo.claimGuest(room.data, participant, await sha(writeToken));
          if (outcome !== 'ok') return json({ error: outcome }, outcome === 'full' ? 409 : 404);
          return json({ roomCode: room.data, participantId: participant, writeToken });
        }
        const auth = async () => {
          const value = request.headers.get('authorization');
          const match = value?.match(/^Bearer (pt_[A-Za-z0-9]{12,64})\.([A-Za-z0-9-]{12,128})$/);
          if (!match) return null;
          const participant = participantIdSchema.safeParse(match[1]);
          if (!participant.success) return null;
          return repo.participant(participant.data, await sha(match[2] ?? ''));
        };
        const turnCredentials = url.pathname.match(/^\/api\/rooms\/([^/]+)\/turn-credentials$/);
        if (turnCredentials && request.method === 'POST') {
          const access = await auth();
          const room = roomCodeSchema.safeParse(turnCredentials[1]);
          if (!access || !room.success || access.room_code !== room.data)
            return json({ error: 'forbidden' }, 403);
          if (!(await repo.roomStatus(room.data))) return json({ error: 'forbidden' }, 403);
          const input = turnCredentialsRequestSchema.safeParse(await body(request));
          if (!input.success) return json({ error: 'invalid TURN credential request' }, 400);
          const configuredAccessCode = env.DIAGNOSTIC_ACCESS_CODE?.trim();
          if (
            !env.XIRSYS_IDENT ||
            !env.XIRSYS_SECRET ||
            !env.XIRSYS_CHANNEL ||
            !configuredAccessCode ||
            configuredAccessCode.length < TURN_ACCESS_CODE_MIN_LENGTH
          )
            return json({ error: 'TURN credential service is not configured' }, 503);
          if (!(await accessCodeMatches(input.data.accessCode, configuredAccessCode)))
            return json({ error: 'The TURN relay access code is incorrect' }, 403);
          try {
            return json(
              await requestXirsysTurnCredentials({
                ident: env.XIRSYS_IDENT,
                secret: env.XIRSYS_SECRET,
                channel: env.XIRSYS_CHANNEL,
              }),
            );
          } catch (error) {
            if (error instanceof XirsysError) return json({ error: error.message }, error.status);
            throw error;
          }
        }
        const roomPath = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
        if (roomPath && request.method === 'GET') {
          const access = await auth();
          const room = roomCodeSchema.safeParse(roomPath[1]);
          if (!access || !room.success || access.room_code !== room.data)
            return json({ error: 'forbidden' }, 403);
          const status = await repo.roomStatus(room.data);
          if (!status) return json({ error: 'missing or expired room' }, 404);
          const currentAttempt = status.generation
            ? await repo.attemptForGeneration(status.code, status.generation)
            : null;
          return json({
            roomCode: status.code,
            hostPresent: true,
            guestPresent: Boolean(status.guest_id),
            generation: status.generation,
            expiresAt: status.expires_at,
            hostParticipantId: status.host_id,
            guestParticipantId: status.guest_id,
            capabilitiesReady:
              Boolean(status.guest_id) && (await repo.capabilities(status.code)).length === 2,
            attemptId: currentAttempt?.id ?? null,
          });
        }
        const leave = url.pathname.match(/^\/api\/rooms\/([^/]+)\/leave$/);
        if (leave && request.method === 'POST') {
          const access = await auth();
          const room = roomCodeSchema.safeParse(leave[1]);
          if (!access || !room.success || access.room_code !== room.data)
            return json({ error: 'forbidden' }, 403);
          return json({ left: await repo.leaveRoom(access) });
        }
        const capabilities = url.pathname.match(/^\/api\/rooms\/([^/]+)\/capabilities$/);
        if (capabilities && request.method === 'POST') {
          const access = await auth();
          const room = roomCodeSchema.safeParse(capabilities[1]);
          const input = z
            .object({ endpoints: endpointsSchema })
            .strict()
            .safeParse(await body(request));
          if (!access || !room.success || access.room_code !== room.data)
            return json({ error: 'forbidden' }, 403);
          if (!input.success) return json({ error: 'invalid capabilities' }, 400);
          await repo.saveCapabilities(access, stableJson(input.data.endpoints));
          return json({ saved: true });
        }
        const attempt = url.pathname.match(/^\/api\/rooms\/([^/]+)\/attempts$/);
        const retry = url.pathname.match(/^\/api\/rooms\/([^/]+)\/retry$/);
        if (request.method === 'POST' && (attempt || retry)) {
          const access = await auth();
          const room = roomCodeSchema.safeParse((attempt ?? retry)![1]);
          const input = z
            .object({ previousAttemptId: attemptIdSchema.nullable().optional() })
            .strict()
            .safeParse(await body(request));
          if (
            !access ||
            !room.success ||
            access.room_code !== room.data ||
            !input.success ||
            (attempt && access.slot !== 1)
          )
            return json({ error: 'forbidden' }, 403);
          if ((attempt && input.data.previousAttemptId) || (retry && !input.data.previousAttemptId))
            return json({ error: 'retry generation is invalid' }, 400);
          const status = await repo.roomStatus(room.data);
          const caps = await repo.capabilities(room.data);
          if (!status?.guest_id || caps.length !== 2)
            return json({ error: 'room capabilities are not ready' }, 409);
          const hostCapabilities = caps.find((item) => item.participant_id === status.host_id);
          const guestCapabilities = caps.find((item) => item.participant_id === status.guest_id);
          if (!hostCapabilities || !guestCapabilities)
            return json({ error: 'room capabilities are not ready' }, 409);
          const manifest = buildProfiles(
            endpointsSchema.parse(JSON.parse(hostCapabilities.endpoints_json)),
            endpointsSchema.parse(JSON.parse(guestCapabilities.endpoints_json)),
          );
          try {
            const issued = await repo.issueAttempt(
              room.data,
              stableJson(manifest),
              input.data.previousAttemptId ?? null,
            );
            return json(issued, 201);
          } catch (error) {
            return json(
              { error: error instanceof Error ? error.message : 'attempt issuance failed' },
              409,
            );
          }
        }
        const attemptDetail = url.pathname.match(/^\/api\/rooms\/([^/]+)\/attempts\/([^/]+)$/);
        if (attemptDetail && request.method === 'GET') {
          const access = await auth();
          const room = roomCodeSchema.safeParse(attemptDetail[1]);
          const id = attemptIdSchema.safeParse(attemptDetail[2]);
          if (!access || !room.success || !id.success || access.room_code !== room.data)
            return json({ error: 'forbidden' }, 403);
          const record = await repo.attempt(id.data);
          if (!record || record.room_code !== room.data) return json({ error: 'not found' }, 404);
          return json(await repo.attemptStatus(record));
        }
        const ack = url.pathname.match(/^\/api\/rooms\/([^/]+)\/attempts\/([^/]+)\/ack$/);
        if (ack && request.method === 'POST') {
          const access = await auth();
          const room = roomCodeSchema.safeParse(ack[1]);
          const id = attemptIdSchema.safeParse(ack[2]);
          const input = z
            .object({ manifest: manifestSchema })
            .strict()
            .safeParse(await body(request));
          if (
            !access ||
            !room.success ||
            !id.success ||
            !input.success ||
            access.room_code !== room.data
          )
            return json({ error: 'forbidden' }, 403);
          const record = await repo.attempt(id.data);
          if (!record || record.room_code !== room.data) return json({ error: 'not found' }, 404);
          try {
            return json(
              await repo.acknowledgeAttempt(record, access, stableJson(input.data.manifest)),
            );
          } catch {
            return json({ error: 'invalid acknowledgement' }, 400);
          }
        }
        const signal = url.pathname.match(/^\/api\/signals\/([^/]+)$/);
        if (signal) {
          const access = await auth();
          const requestedAttempt = attemptIdSchema.safeParse(signal[1]);
          const probe = probeIdSchema.safeParse(url.searchParams.get('probe'));
          const generation = z.coerce
            .number()
            .int()
            .nonnegative()
            .safeParse(url.searchParams.get('generation'));
          if (!access || !requestedAttempt.success || !probe.success || !generation.success)
            return json({ error: 'forbidden' }, 403);
          const room = await repo.roomStatus(access.room_code);
          const activeAttempt = await repo.attemptForGeneration(access.room_code, generation.data);
          if (
            !room ||
            room.generation !== generation.data ||
            !activeAttempt ||
            activeAttempt.id !== requestedAttempt.data ||
            !(await repo.attemptStatus(activeAttempt)).paired
          )
            return json({ error: 'attempt not ready' }, 409);
          if (request.method === 'POST') {
            const input = z
              .object({
                recipientId: participantIdSchema,
                messageId: z.string().min(8).max(128),
                body: z
                  .object({
                    type: z.enum(['offer', 'answer', 'candidate', 'bye']),
                    payload: z.string().max(64_000),
                  })
                  .strict(),
              })
              .strict()
              .safeParse(await body(request));
            if (!input.success) return json({ error: 'invalid signal' }, 400);
            const room = await repo.roomStatus(access.room_code);
            if (
              !room ||
              input.data.recipientId === access.id ||
              (input.data.recipientId !== room.host_id && input.data.recipientId !== room.guest_id)
            )
              return json({ error: 'invalid recipient' }, 400);
            const added = await repo.appendSignal(
              access.room_code,
              generation.data,
              probe.data,
              access.id,
              input.data.recipientId,
              input.data.messageId,
              JSON.stringify(input.data.body),
            );
            return json({ accepted: added });
          }
          if (request.method === 'GET') {
            const cursor = z.coerce
              .number()
              .int()
              .nonnegative()
              .safeParse(url.searchParams.get('cursor') ?? '0');
            if (!cursor.success) return json({ error: 'invalid cursor' }, 400);
            return json({
              signals: await repo.pollSignals(access.id, generation.data, probe.data, cursor.data),
            });
          }
        }
        if (request.method === 'POST' && url.pathname === '/api/runs') {
          const access = await auth();
          const input = z
            .object({ runId: runIdSchema, attemptId: attemptIdSchema.nullable().optional() })
            .strict()
            .safeParse(await body(request));
          if (!access || !input.success) return json({ error: 'forbidden' }, 403);
          if (input.data.attemptId) {
            const record = await repo.attempt(input.data.attemptId);
            if (!record || record.room_code !== access.room_code)
              return json({ error: 'invalid attempt' }, 400);
          }
          await repo.registerRun(input.data.runId, access.id, input.data.attemptId ?? null);
          return json({ ok: true }, 201);
        }
        const events = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
        if (request.method === 'POST' && events) {
          const access = await auth();
          const run = runIdSchema.safeParse(events[1]);
          const input = z
            .object({ events: z.array(diagnosticEventSchema).min(1).max(100) })
            .strict()
            .safeParse(await body(request));
          if (
            !access ||
            !run.success ||
            !input.success ||
            input.data.events.some((event) => event.runId !== run.data) ||
            !(await repo.ownsRun(run.data, access.id))
          )
            return json({ error: 'forbidden' }, 403);
          return json(
            await repo.appendEvents(
              run.data,
              input.data.events.map((event) => ({
                sequence: event.sequence,
                body: JSON.stringify(redact(event)),
              })),
            ),
          );
        }
        if (url.pathname.startsWith('/api/admin/')) {
          if (!(await requireOwner(request, env.OWNER_ID, identity)))
            return json({ error: 'forbidden' }, 403);
          if (request.method !== 'GET') return json({ error: 'not found' }, 404);
          if (url.pathname === '/api/admin/attempts')
            return json({ attempts: await repo.listAttemptReports() });
          if (url.pathname === '/api/admin/runs') return json({ runs: await repo.listRuns() });
          const detail = url.pathname.match(/^\/api\/admin\/(?:attempts|runs)\/([^/]+)$/);
          if (detail) {
            const attempt = attemptIdSchema.safeParse(detail[1]);
            if (attempt.success) {
              const report = await repo.attemptReport(attempt.data);
              return report ? json(report) : json({ error: 'not found' }, 404);
            }
            const run = runIdSchema.safeParse(detail[1]);
            if (!run.success) return json({ error: 'not found' }, 404);
            const report = await repo.runDetail(run.data);
            return report ? json(report) : json({ error: 'not found' }, 404);
          }
          if (url.pathname === '/api/admin/export') {
            const runs = await Promise.all(
              (await repo.exportRuns()).map(async (run) => ({
                ...run,
                report: await repo.runDetail(run.id),
              })),
            );
            return json({ runs });
          }
          return json({ error: 'not found' }, 404);
        }
        // Keep the API Worker and Vite client as separate outputs locally while
        // letting Sites serve the packaged client assets in production.
        if (!url.pathname.startsWith('/api/') && env.ASSETS) {
          const asset = await env.ASSETS.fetch(request);
          // The Vite client owns browser routes such as /admin. Sites serves
          // concrete assets first; only a missing non-API asset falls back to
          // the client entry point.
          if (asset.status !== 404) return asset;
          return env.ASSETS.fetch(new Request(new URL('/', request.url)));
        }
        return json({ error: 'not found' }, 404);
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error && error.message === 'request too large'
                ? 'request too large'
                : 'bad request',
          },
          400,
        );
      }
    },
  };
}
export default createWorker();
