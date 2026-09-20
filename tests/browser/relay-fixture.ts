import type { BrowserContext } from '@playwright/test';

export type RelayStatsMode =
  'verified' | 'missing-protocol' | 'missing-link' | 'mismatch' | 'no-relay';

/** Real local data channels with synthetic relay configuration/candidate stats.
 * This exercises application decisions, not TURN allocation or traversal. */
export async function installRelayStatsFixture(context: BrowserContext, mode: RelayStatsMode) {
  await context.addInitScript((statsMode) => {
    window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
      construct(target, args: ConstructorParameters<typeof RTCPeerConnection>) {
        const requested = args[0];
        if (requested?.iceTransportPolicy !== 'relay') return Reflect.construct(target, args);
        const pc = new target({ iceServers: [] });
        Object.defineProperty(pc, 'getConfiguration', { value: () => requested });
        pc.addEventListener('icecandidate', (event) => {
          if (event.candidate && statsMode !== 'no-relay')
            Object.defineProperty(event.candidate, 'type', { value: 'relay' });
        });
        const nativeStats = pc.getStats.bind(pc);
        const url =
          requested.iceServers?.flatMap((server) =>
            typeof server.urls === 'string' ? [server.urls] : server.urls,
          )[0] ?? '';
        const access = url.startsWith('turns:')
          ? 'tls'
          : url.includes('transport=tcp')
            ? 'tcp'
            : 'udp';
        Object.defineProperty(pc, 'getStats', {
          value: async () => {
            const native = await nativeStats();
            const reports = new Map<string, Record<string, unknown>>();
            for (const [id, value] of native) {
              const raw: unknown = value;
              if (!raw || typeof raw !== 'object') continue;
              const entry: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
              if (
                statsMode !== 'no-relay' &&
                (entry.type === 'local-candidate' || entry.type === 'remote-candidate')
              ) {
                entry.candidateType = 'relay';
                entry.protocol = 'udp';
                if (entry.type === 'local-candidate' && statsMode !== 'missing-protocol')
                  entry.relayProtocol = statsMode === 'mismatch' ? 'tcp' : access;
                else delete entry.relayProtocol;
              }
              if (entry.type === 'candidate-pair') {
                delete entry.selected;
                if (statsMode === 'missing-link') delete entry.nominated;
              }
              if (entry.type === 'transport' && statsMode === 'missing-link')
                delete entry.selectedCandidatePairId;
              reports.set(id, entry);
            }
            return reports;
          },
        });
        return pc;
      },
    });
  }, mode);
}
