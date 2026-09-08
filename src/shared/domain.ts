import { z } from 'zod';

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{12,64}$`));
export const runIdSchema = id('run');
export const attemptIdSchema = id('att');
export const probeIdSchema = id('prb');
export const participantIdSchema = id('pt');
export const roomCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6,10}$/);
export const sessionStateSchema = z.enum([
  'idle',
  'preflight',
  'creating/joining',
  'waiting-for-peer',
  'signaling',
  'checking',
  'connected',
  'disconnected',
  'failed',
  'closed',
]);
export type SessionState = z.infer<typeof sessionStateSchema>;
export type IdSource = () => string;
type BrowserCrypto = Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>>;
export function randomIdSource(source: BrowserCrypto = crypto) {
  if (typeof source.randomUUID === 'function') return source.randomUUID().replaceAll('-', '');
  const bytes = source.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export const createId = (prefix: string, source: IdSource = randomIdSource) =>
  `${prefix}_${source()}`;

const iceUrl = z
  .string()
  .max(256)
  .refine(
    (value) => /^(stun|turn|turns):[^\s/:]+(?::\d{1,5})?(?:\?transport=(udp|tcp))?$/.test(value),
    'unsupported ICE URL',
  );
const server = z
  .object({
    urls: z.union([iceUrl, z.array(iceUrl).min(1).max(3)]),
    username: z.string().max(256).optional(),
    credential: z.string().max(512).optional(),
  })
  .strict();
export const iceConfigSchema = z
  .object({ iceServers: z.array(server).max(9) })
  .strict()
  .superRefine((config, context) => {
    const urls = config.iceServers.flatMap((entry) =>
      typeof entry.urls === 'string' ? [entry.urls] : entry.urls,
    );
    const stun = urls.filter((url) => url.startsWith('stun:'));
    const turn = urls.filter((url) => url.startsWith('turn'));
    if (stun.length > 3) context.addIssue({ code: 'custom', message: 'at most three STUN URLs' });
    if (turn.length > 6) context.addIssue({ code: 'custom', message: 'at most six TURN URLs' });
    if (new Set(urls).size !== urls.length)
      context.addIssue({ code: 'custom', message: 'duplicate ICE URLs are not allowed' });
    for (const entry of config.iceServers) {
      const hasTurn = (typeof entry.urls === 'string' ? [entry.urls] : entry.urls).some((url) =>
        url.startsWith('turn'),
      );
      if (hasTurn && (!entry.username || !entry.credential))
        context.addIssue({ code: 'custom', message: 'TURN requires username and credential' });
    }
  });
export type IceConfig = z.infer<typeof iceConfigSchema>;
/** A credential-free, per-URL identity.  IDs are stable for a configuration
 * and intentionally disclose neither TURN credentials nor a credential hash. */
export type SanitizedIceServer = {
  id: string;
  urls: string[];
  kind: 'stun' | 'turn';
  transports: string[];
};
export function sanitizeIceConfig(config: IceConfig): SanitizedIceServer[] {
  let stun = 0;
  let turn = 0;
  return config.iceServers.flatMap((entry) => {
    const urls = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
    return urls.map((url) => {
      const kind = url.startsWith('turn') ? 'turn' : 'stun';
      const transport = url.startsWith('turns:')
        ? 'tls'
        : url.includes('transport=tcp')
          ? 'tcp'
          : 'udp';
      const index = kind === 'turn' ? turn++ : stun++;
      return { id: `${kind}-${transport}-${index}`, urls: [url], kind, transports: [transport] };
    });
  });
}

export function iceServerAddress(url: string): string {
  const match = /^(stun|turn|turns):([^?]+)(?:\?transport=(udp|tcp))?$/.exec(url);
  if (!match) return url;
  const [, scheme, address, requestedTransport] = match;
  if (scheme === 'stun') return address!;
  const transport = scheme === 'turns' ? 'TLS' : (requestedTransport ?? 'udp').toUpperCase();
  return `${address} (${transport})`;
}

export function iceProfileLabel(id: string, config: IceConfig): string {
  if (id === 'direct-udp') return 'Direct UDP';
  if (id === 'direct-tcp') return 'Direct TCP';
  const endpoint = sanitizeIceConfig(config).find((value) => value.id === id);
  if (!endpoint) return id;
  return `${endpoint.kind.toUpperCase()} ${iceServerAddress(endpoint.urls[0]!)}`;
}

export const diagnosticEventSchema = z
  .object({
    runId: runIdSchema,
    attemptId: attemptIdSchema.optional(),
    probeId: probeIdSchema.optional(),
    peerConnectionId: z.string().max(100).optional(),
    configurationVersion: z.string().max(100).optional(),
    spanId: z.string().max(80),
    parentSpanId: z.string().max(80).optional(),
    sequence: z.number().int().nonnegative(),
    type: z.enum(['operation', 'candidate', 'stats', 'failure', 'summary', 'truncation']),
    outcome: z.enum(['start', 'end', 'success', 'failure', 'timeout', 'cancelled', 'info']),
    elapsedMs: z.number().nonnegative().max(86_400_000),
    clientTime: z.string().datetime(),
    payload: z
      .object({
        stage: z.string().max(40).optional(),
        message: z.string().max(500).optional(),
        candidateType: z.enum(['host', 'srflx', 'prflx', 'relay']).optional(),
        protocol: z.enum(['udp', 'tcp', 'tls']).optional(),
        addressFamily: z.enum(['ipv4', 'ipv6', 'mdns', 'unavailable']).optional(),
        errorCode: z.string().max(80).optional(),
        count: z.number().int().nonnegative().max(1_000_000).optional(),
      })
      .strict(),
  })
  .strict();
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;
export function redact(value: unknown): unknown {
  if (typeof value === 'string')
    return value
      .replace(/(credential|password|token|ufrag|pwd)\s*[:=]\s*[^\s,}"']+/gi, '$1=[REDACTED]')
      .replace(/\b(?:turns?|stun):[^\s,"']+/gi, '[ICE-URL]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) =>
        /credential|password|token|ufrag|pwd|sdp/i.test(key)
          ? [key, '[REDACTED]']
          : [key, redact(item)],
      ),
    );
  return value;
}

export type Profile = {
  id: string;
  a: string;
  b: string;
  tier: number;
  status: 'queued' | 'running' | 'terminal';
};
export function profileTier(a: string, b: string): number {
  const hops = [a, b];
  // A route is classified by its weakest transport hop, never its strongest one.
  if (hops.some((hop) => hop === 'direct-tcp')) return 4;
  if (hops.some((hop) => hop.startsWith('turn-tcp'))) return 3;
  if (hops.some((hop) => hop.startsWith('turn-tls'))) return 2;
  if (hops.some((hop) => hop.startsWith('turn-udp'))) return 1;
  return 0;
}
export function profileUsesTurn(profile: Pick<Profile, 'a' | 'b'>): boolean {
  return profile.a.startsWith('turn-') || profile.b.startsWith('turn-');
}
export function buildProfiles(a: SanitizedIceServer[], b: SanitizedIceServer[]): Profile[] {
  const endpoints = (servers: SanitizedIceServer[]) => [
    'direct-udp',
    'direct-tcp',
    ...servers.map((endpoint) => endpoint.id),
  ];
  const entries = [
    ...new Set(endpoints(a).flatMap((left) => endpoints(b).map((right) => `${left}|${right}`))),
  ];
  return entries.map((key) => {
    const [left, right] = key.split('|') as [string, string];
    return {
      id: `profile_${key}`,
      a: left,
      b: right,
      tier: profileTier(left, right),
      status: 'queued',
    };
  });
}
export function nextProfiles(
  profiles: Profile[],
  capacity: number,
  now: number,
  queuedAt: Map<string, number>,
) {
  return profiles
    .filter((p) => p.status === 'queued')
    .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id))
    .slice(0, capacity)
    .map((p) => ({
      ...p,
      status: 'running' as const,
      queuedMs: now - (queuedAt.get(p.id) ?? now),
      deadlineAt: now + 30_000,
    }));
}
export type ProfileResult = Profile & { outcome?: string };
/**
 * Select only after every route that could outrank it is terminal.  We also
 * wait for its own tier so the id tie-break cannot depend on completion order.
 */
export function selectEligibleProfile<T extends ProfileResult>(profiles: T[]): T | undefined {
  const passing = profiles
    .filter((profile) => profile.status === 'terminal' && profile.outcome === 'pass')
    .sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  const candidate = passing[0];
  if (!candidate) return undefined;
  return profiles
    .filter((profile) => profile.tier <= candidate.tier)
    .every((profile) => profile.status === 'terminal')
    ? candidate
    : undefined;
}
export function percentile(values: number[], p: number) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}
export function goodputMbps(bytes: number, elapsedMs: number) {
  return elapsedMs > 0 ? (bytes * 8) / (elapsedMs * 1000) : undefined;
}
