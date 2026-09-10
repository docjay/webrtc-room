import { describe, expect, it, vi } from 'vitest';
import { copyReport, formatReportText, ReportBuffer } from '../src/client/report.js';
import { diagnosticEventSchema } from '../src/shared/domain.js';

describe('local report snapshot', () => {
  it('reserves space for terminal summaries when candidate detail reaches its limit', () => {
    const report = new ReportBuffer();
    for (let index = 0; index < 5_000; index++)
      report.record('candidate', 'info', 'host candidate');
    expect(report.dropped).toBeGreaterThan(0);
    const terminal = report.record('summary', 'timeout', 'Direct deadline reached');
    expect(terminal).toBeDefined();
    expect(report.snapshot().events.at(-1)).toBe(terminal);
    expect(report.snapshot().events.length).toBeLessThanOrEqual(5_000);
  });

  it('preserves approved candidate addresses and correlation while redacting secrets', () => {
    const report = new ReportBuffer();
    const event = report.record(
      'candidate',
      'info',
      'local host 192.0.2.10:5000 remote [2001:db8::1]:5001 peer.local credential=client-secret ufrag=ice-secret',
      125,
      'att_abcdefghijkl',
      {
        probeId: 'prb_abcdefghijkl',
        peerConnectionId: 'prb_abcdefghijkl:a',
        configurationVersion: '3',
      },
    );
    expect(diagnosticEventSchema.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      type: 'candidate',
      elapsedMs: 125,
      attemptId: 'att_abcdefghijkl',
      probeId: 'prb_abcdefghijkl',
      peerConnectionId: 'prb_abcdefghijkl:a',
      configurationVersion: '3',
    });
    const text = formatReportText(report.completeSnapshot());
    expect(text).toContain('192.0.2.10:5000');
    expect(text).toContain('[2001:db8::1]:5001');
    expect(text).toContain('peer.local');
    expect(text).not.toMatch(/client-secret|ice-secret/);
  });

  it('uses one complete redacted snapshot for compact, copy, and download callers', async () => {
    const report = new ReportBuffer();
    report.record('summary', 'failure', 'credential=secret endpoint failed');
    const snapshot = report.completeSnapshot({
      attemptId: 'att_abcdefghijkl',
      outcome: 'unable-to-connect',
      deviceChecks: [{ id: 'stun-0', outcome: 'timeout' }],
      matrix: [{ id: 'direct', outcome: 'failure' }],
      uploadStatus: 'upload-failed',
    });
    const text = formatReportText(snapshot);
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();

    await copyReport(snapshot, { writeText });

    expect(writeText).toHaveBeenCalledWith(text);
    expect(text).toContain('"attemptId": "att_abcdefghijkl"');
    expect(text).toContain('"deviceChecks"');
    expect(text).toContain('"matrix"');
    expect(text).toContain('"uploadStatus": "upload-failed"');
    expect(text).not.toContain('secret');
  });

  it('surfaces clipboard failures to the caller', async () => {
    const failure = new Error('permission denied');
    const writeText = vi.fn<(value: string) => Promise<void>>().mockRejectedValue(failure);

    await expect(copyReport({ runId: 'run_abcdefghijkl' }, { writeText })).rejects.toBe(failure);
  });
});
