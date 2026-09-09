import { z } from 'zod';
import { iceConfigSchema } from '../shared/domain.js';

const upstreamServerSchema = z
  .object({
    url: z.string().optional(),
    urls: z.union([z.string(), z.array(z.string()).min(1).max(9)]).optional(),
    username: z.string().min(1).max(256).optional(),
    credential: z.string().min(1).max(512).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if ((value.url === undefined && value.urls === undefined) || (value.url && value.urls))
      context.addIssue({ code: 'custom', message: 'exactly one URL field is required' });
  });

const upstreamResponseSchema = z
  .object({
    v: z.object({ iceServers: z.array(z.unknown()).min(1).max(9) }).passthrough(),
  })
  .passthrough();

export type TurnCredentials = {
  iceServers: Array<{ urls: string[]; username: string; credential: string }>;
};

export class XirsysError extends Error {
  constructor(
    readonly status: 502 | 504,
    override readonly message:
      | 'TURN credential service unavailable'
      | 'TURN credential service timed out'
      | 'TURN provider rejected its API credentials or channel',
  ) {
    super(message);
  }
}

function basicAuthorization(ident: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${ident}:${secret}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function channelPath(channel: string): string {
  return channel
    .trim()
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export async function requestXirsysTurnCredentials(config: {
  ident: string;
  secret: string;
  channel: string;
}): Promise<TurnCredentials> {
  let response: Response;
  try {
    const body = JSON.stringify({ format: 'urls' });
    response = await fetch(`https://global.xirsys.net/_turn/${channelPath(config.channel)}`, {
      method: 'PUT',
      headers: {
        authorization: basicAuthorization(config.ident, config.secret),
        'content-type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      throw new XirsysError(504, 'TURN credential service timed out');
    throw new XirsysError(502, 'TURN credential service unavailable');
  }

  if ([401, 403].includes(response.status))
    throw new XirsysError(502, 'TURN provider rejected its API credentials or channel');
  if (!response.ok) throw new XirsysError(502, 'TURN credential service unavailable');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new XirsysError(502, 'TURN credential service unavailable');
  }

  const upstream = upstreamResponseSchema.safeParse(payload);
  if (!upstream.success) throw new XirsysError(502, 'TURN credential service unavailable');

  const entries = upstream.data.v.iceServers.map((entry) => upstreamServerSchema.safeParse(entry));
  if (entries.some((entry) => !entry.success))
    throw new XirsysError(502, 'TURN credential service unavailable');

  const iceServers = entries.flatMap((entry) => {
    const server = entry.data!;
    const urls = server.urls ?? server.url!;
    const normalizedUrls = (typeof urls === 'string' ? [urls] : urls).filter(
      (url) => url.startsWith('turn:') || url.startsWith('turns:'),
    );
    if (!normalizedUrls.length) return [];
    const { username, credential } = server;
    if (!username || !credential) throw new XirsysError(502, 'TURN credential service unavailable');
    return normalizedUrls.map((url) => ({
      urls: [url],
      username,
      credential,
    }));
  });
  const normalized = iceConfigSchema.safeParse({ iceServers });
  if (!normalized.success || !iceServers.length)
    throw new XirsysError(502, 'TURN credential service unavailable');

  return { iceServers };
}
