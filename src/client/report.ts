import { createId, redact, type DiagnosticEvent } from '../shared/domain.js';
const MAX_EVENTS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;
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
  ): DiagnosticEvent | undefined {
    const event: DiagnosticEvent = {
      runId: this.runId,
      ...(attemptId ? { attemptId } : {}),
      spanId: createId('span'),
      sequence: this.sequence++,
      type,
      outcome,
      elapsedMs,
      clientTime: new Date().toISOString(),
      payload: { message: String(redact(message)).slice(0, 500) },
    };
    const size = JSON.stringify(event).length;
    if (this.events.length >= MAX_EVENTS || this.bytes + size > MAX_BYTES) {
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
      events: this.events,
      dropped: this.dropped,
      generatedAt: new Date().toISOString(),
    };
  }
  text() {
    return this.events
      .map((e) => `${e.clientTime} ${e.type}/${e.outcome}: ${e.payload.message ?? ''}`)
      .join('\n');
  }
}
export function downloadReport(report: unknown) {
  const blob = new Blob([JSON.stringify(redact(report), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'webrtc-diagnostic-report.json';
  anchor.click();
  URL.revokeObjectURL(url);
}
