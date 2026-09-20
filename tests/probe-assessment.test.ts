import { describe, expect, it } from 'vitest';
import {
  aggregateAssessment,
  connectivityFromOutcome,
  validateAssessment,
} from '../src/shared/probe-assessment.js';

const twoSidedTurn = { hostUsesTurn: true, guestUsesTurn: true };

describe('probe assessments', () => {
  it('keeps confirmed connectivity when one TURN side lacks protocol stats', () => {
    expect(
      aggregateAssessment(
        [
          { participantSlot: 1, connectivity: 'pass', protocolVerification: 'verified' },
          { participantSlot: 2, connectivity: 'pass', protocolVerification: 'unavailable' },
        ],
        twoSidedTurn,
      ),
    ).toEqual({ connectivity: 'pass', protocolVerification: 'unavailable' });
  });

  it('requires every requested TURN side to verify its own access protocol', () => {
    expect(
      aggregateAssessment(
        [
          { participantSlot: 1, connectivity: 'pass', protocolVerification: 'verified' },
          { participantSlot: 2, connectivity: 'pass', protocolVerification: 'verified' },
        ],
        twoSidedTurn,
      ),
    ).toEqual({ connectivity: 'pass', protocolVerification: 'verified' });
  });

  it('does not verify a partial or duplicate TURN assessment', () => {
    expect(
      aggregateAssessment(
        [{ participantSlot: 1, connectivity: 'pass', protocolVerification: 'verified' }],
        twoSidedTurn,
      ),
    ).toEqual({ connectivity: 'unconfirmed', protocolVerification: 'not-tested' });
    expect(
      aggregateAssessment(
        [
          { participantSlot: 1, connectivity: 'pass', protocolVerification: 'verified' },
          { participantSlot: 1, connectivity: 'pass', protocolVerification: 'verified' },
        ],
        twoSidedTurn,
      ),
    ).toEqual({ connectivity: 'unconfirmed', protocolVerification: 'not-tested' });
  });

  it('preserves actual transport timeout or failure and handles one-sided TURN', () => {
    expect(
      aggregateAssessment(
        [
          { participantSlot: 1, connectivity: 'timeout', protocolVerification: 'mismatch' },
          { participantSlot: 2, connectivity: 'pass', protocolVerification: 'not-applicable' },
        ],
        { hostUsesTurn: true, guestUsesTurn: false },
      ),
    ).toEqual({ connectivity: 'timeout', protocolVerification: 'mismatch' });
    expect(connectivityFromOutcome('failure')).toBe('failure');
  });

  it('does not promote legacy inconclusive outcomes or inferred verification', () => {
    expect(
      validateAssessment('inconclusive', {}, { hostUsesTurn: true, guestUsesTurn: false }, 1),
    ).toEqual({ connectivity: 'unconfirmed', protocolVerification: 'not-tested' });
    expect(
      validateAssessment(
        'pass',
        { connectivity: 'pass', protocolVerification: 'verified' },
        { hostUsesTurn: false, guestUsesTurn: false },
        1,
      ),
    ).toBeNull();
  });

  it('rejects outcome/connectivity contradictions without discarding them', () => {
    expect(validateAssessment('pass', { connectivity: 'failure' }, twoSidedTurn, 1)).toBeNull();
  });
});
