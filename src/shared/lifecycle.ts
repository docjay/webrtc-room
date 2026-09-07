import type { SessionState } from './domain.js';
const legal: Record<SessionState, readonly SessionState[]> = {
  idle: ['preflight', 'closed'],
  preflight: ['idle', 'creating/joining', 'failed', 'closed'],
  'creating/joining': ['waiting-for-peer', 'failed', 'closed'],
  'waiting-for-peer': ['signaling', 'failed', 'closed'],
  signaling: ['checking', 'failed', 'closed'],
  checking: ['connected', 'disconnected', 'failed', 'closed'],
  connected: ['disconnected', 'closed'],
  disconnected: ['signaling', 'closed'],
  failed: ['preflight', 'closed'],
  closed: [],
};
export function transition(current: SessionState, next: SessionState): SessionState {
  if (!legal[current].includes(next)) throw new Error(`invalid transition ${current} -> ${next}`);
  return next;
}
export function isTerminal(state: SessionState) {
  return state === 'failed' || state === 'closed';
}
