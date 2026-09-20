import type { ConnectivityOutcome, ProtocolVerification } from '../shared/probe-assessment.js';

export function connectivityLabel(outcome: ConnectivityOutcome, relay = false): string {
  const kind = relay ? 'Relay connectivity' : 'Connectivity';
  const labels: Record<ConnectivityOutcome, string> = {
    pass: 'passed',
    failure: 'failed',
    timeout: 'timed out',
    unconfirmed: 'not confirmed',
  };
  return `${kind}: ${labels[outcome]}`;
}

export function protocolVerificationLabel(status: ProtocolVerification): string {
  const labels: Record<ProtocolVerification, string> = {
    verified: 'verified on every required relay side',
    unavailable: 'verification unavailable (browser evidence incomplete)',
    mismatch: 'mismatch (observed protocol differs from the request)',
    'not-tested': 'not verified (no protocol assessment recorded)',
    'not-applicable': 'not applicable',
  };
  return `Requested TURN access protocol: ${labels[status]}`;
}
