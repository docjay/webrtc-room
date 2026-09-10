import { iceConfigSchema, type IceConfig } from '../shared/domain.js';
import { ApiError } from './api.js';

export class ManagedTurnRefreshError extends Error {}

function endpointRole(url: string) {
  const match = /^(turns?):([^:?\s]+)(?::(\d+))?(?:\?transport=(udp|tcp))?$/.exec(url);
  if (!match || (match[1] === 'turns' && match[4] === 'udp')) return undefined;
  const transport = match[1] === 'turns' ? 'tls' : (match[4] ?? 'udp');
  return `${transport}:${Number(match[3] ?? (transport === 'tls' ? 5349 : 3478))}`;
}

function endpoints(config: IceConfig) {
  return config.iceServers.flatMap((server) =>
    (typeof server.urls === 'string' ? [server.urls] : server.urls).map((url) => ({
      url,
      username: server.username,
      credential: server.credential,
    })),
  );
}

/** Preserve manifest slot order, never borrowing credentials for an old URL. */
export function alignTemporaryTurnCredentials(reference: IceConfig, fresh: IceConfig): IceConfig {
  const parsedReference = iceConfigSchema.safeParse(reference);
  const parsedFresh = iceConfigSchema.safeParse(fresh);
  if (!parsedReference.success || !parsedFresh.success)
    throw new ManagedTurnRefreshError('TURN refresh returned an invalid relay configuration');
  const available = endpoints(parsedFresh.data);
  const requested = endpoints(parsedReference.data);
  const reserved = new Set(
    available
      .filter((candidate) => requested.some((entry) => entry.url === candidate.url))
      .map((entry) => entry.url),
  );
  const used = new Set<string>();
  const aligned = requested.map((original) => {
    const role = endpointRole(original.url);
    if (!role)
      throw new ManagedTurnRefreshError('TURN refresh cannot align the requested endpoint');
    const exact = available.filter((candidate) => candidate.url === original.url);
    const compatible = exact.length
      ? exact
      : available.filter(
          (candidate) =>
            endpointRole(candidate.url) === role &&
            !used.has(candidate.url) &&
            !reserved.has(candidate.url),
        );
    if (compatible.length !== 1 || used.has(compatible[0]!.url))
      throw new ManagedTurnRefreshError(
        compatible.length > 1
          ? 'TURN refresh returned ambiguous relay endpoints'
          : 'TURN refresh did not preserve the requested transport and port',
      );
    const replacement = compatible[0]!;
    if (!replacement.username || !replacement.credential)
      throw new ManagedTurnRefreshError('TURN refresh returned missing temporary credentials');
    used.add(replacement.url);
    return {
      urls: [replacement.url],
      username: replacement.username,
      credential: replacement.credential,
    };
  });
  const result = iceConfigSchema.safeParse({ iceServers: aligned });
  if (!result.success)
    throw new ManagedTurnRefreshError('TURN refresh returned an invalid relay configuration');
  return result.data;
}

const publicErrors = new Set([
  'TURN credential service unavailable',
  'TURN credential service timed out',
  'TURN provider rejected its API credentials or channel',
  'TURN credential service is not configured',
  'The TURN relay access code is incorrect',
  'invalid TURN credential request',
]);

export function managedTurnFailure(error: unknown): string {
  if (error instanceof ManagedTurnRefreshError) return error.message;
  if (error instanceof ApiError)
    return publicErrors.has(error.message)
      ? `${error.message} (HTTP ${error.status})`
      : `TURN credential request failed (HTTP ${error.status})`;
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return 'TURN credential request timed out or was cancelled';
  if (error instanceof Error && error.message === 'server returned an invalid response')
    return 'TURN credential service returned an invalid response';
  return 'TURN credential request failed before a valid response was received';
}
