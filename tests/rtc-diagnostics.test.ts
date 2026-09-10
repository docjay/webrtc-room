import { describe, expect, it, vi } from 'vitest';
import {
  normalizeDiagnosticCandidate,
  PairedRtcDiagnostics,
  type PairedProbeDiagnostic,
} from '../src/client/rtc-diagnostics.js';

describe('paired RTC telemetry', () => {
  it.each([
    [{ address: '192.0.2.10', port: 3478 }, '192.0.2.10', '3478'],
    [{ address: '2001:db8::1', port: 443 }, '2001:db8::1', '443'],
    [{ address: 'host-7.local', port: 9 }, 'host-7.local', '9'],
    [{ address: 'not an address', port: -1 }, 'unavailable', 'unavailable'],
  ])('normalizes safe address fields %#', (source, address, port) => {
    expect(normalizeDiagnosticCandidate(source)).toMatchObject({ address, port });
  });

  it('never copies raw candidates or secret-shaped fields to events', () => {
    const events: PairedProbeDiagnostic[] = [];
    const diagnostics = new PairedRtcDiagnostics('A', 'profile_direct', (event) =>
      events.push(event),
    );
    diagnostics.candidate('remote', 'received', {
      type: 'host',
      protocol: 'udp',
      address: 'candidate:1 1 udp 1 secret password=hidden',
      port: 99999,
      // Candidate strings are deliberately not a supported telemetry field.
      candidate: 'candidate:1 1 udp 1 192.0.2.4 9 typ host ufrag secret',
    });
    diagnostics.embeddedCandidates(
      'offer',
      'v=0\na=candidate:1 1 udp 1 192.0.2.4 9 typ host ufrag secret\na=ice-pwd:secret',
    );
    expect(events[0]!.message).toContain('unavailable:unavailable');
    expect(events.map((event) => event.message).join('\n')).not.toMatch(
      /candidate:|ufrag|ice-pwd|password|secret/i,
    );
  });

  it('prefixes and bounds every diagnostic message', () => {
    const events: PairedProbeDiagnostic[] = [];
    const diagnostics = new PairedRtcDiagnostics('B', 'profile_pair_1', (event) =>
      events.push(event),
    );
    diagnostics.emit('stats', 'info', 'x'.repeat(600));
    expect(events[0]!.message).toMatch(/^Device B · profile_pair_1 · /);
    expect(events[0]!.message.length).toBeLessThanOrEqual(500);
  });

  it('deduplicates unchanged pairs and emits one explicit truncation event', async () => {
    vi.useFakeTimers();
    const events: PairedProbeDiagnostic[] = [];
    const diagnostics = new PairedRtcDiagnostics('B', 'profile_stun', (event) =>
      events.push(event),
    );
    const candidate = (id: string) => ({
      id,
      type: 'local-candidate',
      candidateType: 'srflx',
      protocol: 'udp',
      address: '198.51.100.8',
      port: 3478,
    });
    const pair = (id: string) => ({
      id,
      type: 'candidate-pair',
      state: 'succeeded',
      nominated: true,
      selected: true,
      localCandidateId: `l${id}`,
      remoteCandidateId: `r${id}`,
    });
    const reports = new Map<string, unknown>();
    reports.set('same', pair('same'));
    reports.set('lsame', candidate('lsame'));
    reports.set('rsame', candidate('rsame'));
    const getStats = vi.fn(() => Promise.resolve(reports));
    const pc = {
      getStats,
    } as unknown as RTCPeerConnection;

    diagnostics.startStats(pc);
    await Promise.resolve();
    diagnostics.startStats(pc);
    await Promise.resolve();
    expect(events.filter((event) => event.type === 'stats')).toHaveLength(3);
    for (let index = 0; index <= 120; index++) {
      reports.set(String(index), pair(String(index)));
      reports.set(`l${index}`, candidate(`l${index}`));
      reports.set(`r${index}`, candidate(`r${index}`));
    }
    await vi.advanceTimersByTimeAsync(1_000);
    diagnostics.stop();
    vi.useRealTimers();
    expect(events.filter((event) => event.type === 'truncation')).toHaveLength(1);
  });

  it('stops active sampling on cleanup', async () => {
    vi.useFakeTimers();
    const getStats = vi.fn(() => Promise.resolve(new Map()));
    const pc = {
      getStats,
    } as unknown as RTCPeerConnection;
    const diagnostics = new PairedRtcDiagnostics('A', 'profile_turn', () => undefined);
    diagnostics.startStats(pc);
    await Promise.resolve();
    diagnostics.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(getStats).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('emits nothing after cleanup, including a rejected in-flight stats sample', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<RTCStatsReport>((_, failure) => {
      reject = failure;
    });
    const events: PairedProbeDiagnostic[] = [];
    const diagnostics = new PairedRtcDiagnostics('A', 'profile_cleanup', (event) =>
      events.push(event),
    );
    diagnostics.startStats({ getStats: () => pending } as unknown as RTCPeerConnection);
    diagnostics.stop();
    reject(new Error('secret credential=not-for-log'));
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it('retains timeout state and ignores late candidates without false truncation', () => {
    const events: PairedProbeDiagnostic[] = [];
    const diagnostics = new PairedRtcDiagnostics('A', 'pair-direct-0', (event) =>
      events.push(event),
    );
    for (let port = 1; port <= 80; port++) {
      diagnostics.candidate('local', 'gathered', {
        type: 'host',
        protocol: 'udp',
        address: '192.0.2.10',
        port,
      });
    }
    diagnostics.terminal('timeout', {
      iceConnectionState: 'checking',
      iceGatheringState: 'complete',
      signalingState: 'stable',
    });
    diagnostics.stop();
    diagnostics.candidate('local', 'gathered', { address: '192.0.2.11', port: 81 });
    expect(events.at(-1)).toMatchObject({ type: 'summary', outcome: 'timeout' });
    expect(events.at(-1)!.message).toContain('ICE connection=checking');
    expect(events.at(-1)!.message).toContain('gathering=complete');
    expect(events.filter((event) => event.type === 'truncation')).toHaveLength(0);
  });

  it('recognizes transport-selected pairs without inventing boolean fields', () => {
    const events: PairedProbeDiagnostic[] = [];
    const diagnostics = new PairedRtcDiagnostics('A', 'profile_stats', (event) =>
      events.push(event),
    );
    diagnostics.reportStats(
      new Map([
        ['transport', { type: 'transport', selectedCandidatePairId: 'pair-1' }],
        [
          'pair-1',
          {
            id: 'pair-1',
            type: 'candidate-pair',
            state: 'succeeded',
            localCandidateId: 'local',
            remoteCandidateId: 'remote',
          },
        ],
        [
          'local',
          {
            type: 'local-candidate',
            candidateType: 'host',
            protocol: 'udp',
            address: '2001:db8::1',
            port: 1,
          },
        ],
        [
          'remote',
          {
            type: 'remote-candidate',
            candidateType: 'srflx',
            protocol: 'udp',
            address: '192.0.2.1',
            port: 2,
          },
        ],
      ]),
    );
    const text = events.map((event) => event.message).join('\n');
    expect(text).toContain('nominated=unavailable selected=true');
    expect(text).toContain('local=[2001:db8::1]:1');
    expect(text).toContain('remote=192.0.2.1:2');
  });
});
