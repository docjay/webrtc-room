import { describe, expect, it, vi } from 'vitest';
import { copyReport, formatReportText, ReportBuffer } from '../src/client/report.js';

describe('local report snapshot', () => {
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
