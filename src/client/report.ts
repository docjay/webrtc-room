import { createId, redact, type DiagnosticEvent } from '../shared/domain.js';
const MAX_EVENTS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;
const SUMMARY_RESERVED_EVENTS = 100;
const SUMMARY_RESERVED_BYTES = 64 * 1024;
type EventContext = Pick<DiagnosticEvent, 'probeId' | 'peerConnectionId' | 'configurationVersion'>;
export class ReportBuffer {
  readonly runId = createId('run');
  private events: DiagnosticEvent[] = [];
  private sequence = 0;
  private bytes = 0;
  dropped = 0;
  record(
    type: DiagnosticEvent['type'],
    outcome: DiagnosticEvent['outcome'],
    message: string,
    elapsedMs = 0,
    attemptId?: string,
    { probeId, peerConnectionId, configurationVersion }: EventContext = {},
  ): DiagnosticEvent | undefined {
    const event: DiagnosticEvent = {
      runId: this.runId,
      ...(attemptId ? { attemptId } : {}),
      ...(probeId ? { probeId } : {}),
      ...(peerConnectionId ? { peerConnectionId } : {}),
      ...(configurationVersion ? { configurationVersion } : {}),
      spanId: createId('span'),
      sequence: this.sequence++,
      type,
      outcome,
      elapsedMs,
      clientTime: new Date().toISOString(),
      payload: { message: String(redact(message)).slice(0, 500) },
    };
    const size = JSON.stringify(event).length;
    const important = type === 'summary' || type === 'failure' || type === 'truncation';
    const eventLimit = important ? MAX_EVENTS : MAX_EVENTS - SUMMARY_RESERVED_EVENTS;
    const byteLimit = important ? MAX_BYTES : MAX_BYTES - SUMMARY_RESERVED_BYTES;
    if (this.events.length >= eventLimit || this.bytes + size > byteLimit) {
      this.dropped++;
      return undefined;
    }
    this.events.push(event);
    this.bytes += size;
    return event;
  }
  snapshot() {
    return {
      runId: this.runId,
      events: [...this.events],
      dropped: this.dropped,
      generatedAt: new Date().toISOString(),
    };
  }
  completeSnapshot(details: Record<string, unknown> = {}) {
    return redact({ ...this.snapshot(), ...details });
  }
}

export function formatReportText(report: unknown) {
  return JSON.stringify(redact(report), null, 2);
}

export async function copyReport(
  report: unknown,
  clipboard: Pick<Clipboard, 'writeText'> = navigator.clipboard,
) {
  await clipboard.writeText(formatReportText(report));
}

export function downloadReport(report: unknown) {
  const blob = new Blob([formatReportText(report)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'webrtc-diagnostic-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
}
