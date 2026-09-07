import { z } from 'zod';
import {
  attemptIdSchema,
  participantIdSchema,
  probeIdSchema,
  roomCodeSchema,
} from '../shared/domain.js';
import type { DiagnosticEvent } from '../shared/domain.js';

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
    manifest: z.array(
      z.object({ id: z.string(), a: z.string(), b: z.string(), tier: z.number() }).passthrough(),
    ),
  })
  .strict();
export type Credentials = z.infer<typeof credentialsSchema>;
export type RoomStatus = z.infer<typeof statusSchema>;
export type IssuedAttempt = z.infer<typeof attemptSchema>;

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
      throw new Error(
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
    recipientId: string,
    body: { type: 'offer' | 'answer' | 'candidate' | 'bye'; payload: string },
  ) {
    probeIdSchema.parse(probeId);
    return this.request(
      `/api/signals/${attempt.id}?probe=${probeId}&generation=${attempt.generation}`,
      z.object({ accepted: z.boolean() }),
      {
        method: 'POST',
        body: JSON.stringify({ recipientId, messageId: crypto.randomUUID(), body }),
      },
      credentials,
    );
  }
  pollSignals(credentials: Credentials, attempt: IssuedAttempt, probeId: string, cursor: number) {
    return this.request(
      `/api/signals/${attempt.id}?probe=${probeId}&generation=${attempt.generation}&cursor=${cursor}`,
      z.object({ signals: z.array(z.object({ id: z.number(), body: z.string() })) }),
      {},
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
