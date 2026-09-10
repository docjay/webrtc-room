import { z } from 'zod';
import {
  createId,
  attemptIdSchema,
  iceConfigSchema,
  participantIdSchema,
  probeIdSchema,
  roomCodeSchema,
} from '../shared/domain.js';
import type { DiagnosticEvent, IceConfig } from '../shared/domain.js';
import type { DiagnosticCategory } from '../shared/domain.js';

const credentialsSchema = z
  .object({
    roomCode: roomCodeSchema,
    participantId: participantIdSchema,
    writeToken: z.string().min(12),
  })
  .strict();
const statusSchema = z
  .object({
    roomCode: roomCodeSchema,
    hostPresent: z.boolean(),
    guestPresent: z.boolean(),
    generation: z.number().int(),
    expiresAt: z.number(),
    hostParticipantId: participantIdSchema,
    guestParticipantId: participantIdSchema.nullable(),
    capabilitiesReady: z.boolean(),
    attemptId: attemptIdSchema.nullable(),
  })
  .strict();
const attemptSchema = z
  .object({
    id: attemptIdSchema,
    generation: z.number().int(),
    manifest: z
      .array(
        z.object({
          id: z.enum(['direct', 'stun-assisted', 'turn-udp', 'turn-tls', 'turn-tcp']),
          label: z.string(),
          tier: z.number(),
          alternatives: z.array(
            z.object({
              id: z.string(),
              a: z.string(),
              b: z.string(),
              aLabel: z.string().min(1).max(300),
              bLabel: z.string().min(1).max(300),
              tier: z.number(),
              status: z.literal('queued'),
            }),
          ),
        }),
      )
      .length(5),
  })
  .strict();
export type Credentials = z.infer<typeof credentialsSchema>;
export type RoomStatus = z.infer<typeof statusSchema>;
export type IssuedAttempt = z.infer<typeof attemptSchema>;
export type IssuedDiagnosticManifest = DiagnosticCategory[];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ApiClient {
  constructor(private readonly base = '') {}
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
    credentials?: Credentials,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (credentials)
      headers.set('authorization', `Bearer ${credentials.participantId}.${credentials.writeToken}`);
    const timeout = AbortSignal.timeout(10_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await fetch(`${this.base}${path}`, { ...init, headers, signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        response.status,
        typeof payload === 'object' && payload && 'error' in payload
          ? String(payload.error)
          : `HTTP ${response.status}`,
      );
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error('server returned an invalid response');
    return parsed.data;
  }
  createRoom() {
    return this.request('/api/rooms', credentialsSchema, { method: 'POST', body: '{}' });
  }
  joinRoom(code: string) {
    return this.request(`/api/rooms/${encodeURIComponent(code)}/join`, credentialsSchema, {
      method: 'POST',
      body: '{}',
    });
  }
  status(credentials: Credentials) {
    return this.request(`/api/rooms/${credentials.roomCode}`, statusSchema, {}, credentials);
  }
  leave(credentials: Credentials) {
    return this.request(
      `/api/rooms/${credentials.roomCode}/leave`,
      z.object({ left: z.boolean() }).strict(),
      { method: 'POST', body: '{}' },
      credentials,
    );
  }
  turnCredentials(
    credentials: Credentials,
    accessCode: string,
    signal?: AbortSignal,
  ): Promise<IceConfig> {
    return this.request(
      `/api/rooms/${credentials.roomCode}/turn-credentials`,
      iceConfigSchema,
      { method: 'POST', body: JSON.stringify({ accessCode }), ...(signal ? { signal } : {}) },
      credentials,
    );
  }
  submitCapabilities(credentials: Credentials, endpoints: unknown[]) {
    return this.request(
      `/api/rooms/${credentials.roomCode}/capabilities`,
      z.object({ saved: z.boolean() }).strict(),
      { method: 'POST', body: JSON.stringify({ endpoints }) },
      credentials,
    );
  }
  createAttempt(credentials: Credentials, previousAttemptId?: string) {
    return this.request(
      `/api/rooms/${credentials.roomCode}/attempts`,
      attemptSchema,
      { method: 'POST', body: JSON.stringify(previousAttemptId ? { previousAttemptId } : {}) },
      credentials,
    );
  }
  retry(credentials: Credentials, previousAttemptId: string) {
    return this.request(
      `/api/rooms/${credentials.roomCode}/retry`,
      attemptSchema,
      { method: 'POST', body: JSON.stringify({ previousAttemptId }) },
      credentials,
    );
  }
  attempt(credentials: Credentials, id: string) {
    return this.request(
      `/api/rooms/${credentials.roomCode}/attempts/${id}`,
      attemptSchema.extend({
        acknowledged: z.number(),
        paired: z.boolean(),
        previousAttemptId: attemptIdSchema.nullable(),
      }),
      {},
      credentials,
    );
  }
  acknowledge(credentials: Credentials, attempt: IssuedAttempt) {
    return this.request(
      `/api/rooms/${credentials.roomCode}/attempts/${attempt.id}/ack`,
      z.object({ acknowledged: z.number(), paired: z.boolean() }),
      { method: 'POST', body: JSON.stringify({ manifest: attempt.manifest }) },
      credentials,
    );
  }
  async sendSignal(
    credentials: Credentials,
    attempt: IssuedAttempt,
    probeId: string,
    pairId: string,
    recipientId: string,
    body: { type: 'offer' | 'answer' | 'candidate' | 'bye'; payload: string },
    signal?: AbortSignal,
  ) {
    probeIdSchema.parse(probeId);
    const response = await this.request(
      `/api/signals/${attempt.id}?probe=${probeId}&pair=${encodeURIComponent(pairId)}&generation=${attempt.generation}`,
      z.object({ accepted: z.boolean() }),
      {
        method: 'POST',
        body: JSON.stringify({ recipientId, messageId: createId('signal'), body }),
        ...(signal ? { signal } : {}),
      },
      credentials,
    );
    if (!response.accepted) throw new Error('signal was rejected as a duplicate');
    return response;
  }
  pollSignals(
    credentials: Credentials,
    attempt: IssuedAttempt,
    probeId: string,
    pairId: string,
    cursor: number,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/api/signals/${attempt.id}?probe=${probeId}&pair=${encodeURIComponent(pairId)}&generation=${attempt.generation}&cursor=${cursor}`,
      z.object({ signals: z.array(z.object({ id: z.number(), body: z.string() })) }),
      signal ? { signal } : {},
      credentials,
    );
  }
  probeResult(
    credentials: Credentials,
    attempt: IssuedAttempt,
    pairId: string,
    result?: {
      outcome: 'pass' | 'inconclusive' | 'timeout' | 'unsupported' | 'cancelled' | 'failure';
      detail: string;
      selected?: string;
      elapsedMs: number;
    },
    signal?: AbortSignal,
  ) {
    const safeResult = result && {
      ...result,
      elapsedMs: Math.max(0, Math.min(30_000, Math.round(result.elapsedMs))),
    };
    return this.request(
      `/api/rooms/${credentials.roomCode}/attempts/${attempt.id}/probes/${encodeURIComponent(pairId)}`,
      z.object({
        complete: z.boolean(),
        outcome: z
          .enum(['pass', 'inconclusive', 'timeout', 'unsupported', 'cancelled', 'failure'])
          .optional(),
        results: z.array(
          z.object({
            participant_id: participantIdSchema,
            outcome: z.string(),
            detail: z.string(),
            selected: z.string().nullable(),
            elapsed_ms: z.number(),
          }),
        ),
      }),
      safeResult
        ? { method: 'POST', body: JSON.stringify(safeResult), ...(signal ? { signal } : {}) }
        : signal
          ? { signal }
          : {},
      credentials,
    );
  }
  registerRun(credentials: Credentials, runId: string, attemptId?: string) {
    return this.request(
      '/api/runs',
      z.object({ ok: z.boolean() }).strict(),
      { method: 'POST', body: JSON.stringify({ runId, ...(attemptId ? { attemptId } : {}) }) },
      credentials,
    );
  }
  uploadEvents(credentials: Credentials, runId: string, events: DiagnosticEvent[]) {
    return this.request(
      `/api/runs/${runId}/events`,
      z.object({ accepted: z.number(), truncated: z.number() }).strict(),
      { method: 'POST', body: JSON.stringify({ events }) },
      credentials,
    );
  }
}
