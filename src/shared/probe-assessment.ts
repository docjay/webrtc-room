import { z } from 'zod';

export const connectivitySchema = z.enum(['pass', 'failure', 'timeout', 'unconfirmed']);
export const protocolVerificationSchema = z.enum([
  'verified',
  'unavailable',
  'mismatch',
  'not-tested',
  'not-applicable',
]);
export type ConnectivityOutcome = z.infer<typeof connectivitySchema>;
export type ProtocolVerification = z.infer<typeof protocolVerificationSchema>;
export type ProbeAssessment = {
  connectivity: ConnectivityOutcome;
  protocolVerification: ProtocolVerification;
};

export type ProbeOutcome =
  'pass' | 'inconclusive' | 'timeout' | 'unsupported' | 'cancelled' | 'failure';

export type PairProtocolRequirements = {
  hostUsesTurn: boolean;
  guestUsesTurn: boolean;
};

export type AssessmentEvidence = ProbeAssessment & {
  participantSlot: 1 | 2;
};

/** Converts the legacy combined outcome without treating incomplete evidence as a pass. */
export function connectivityFromOutcome(outcome: ProbeOutcome): ConnectivityOutcome {
  switch (outcome) {
    case 'pass':
      return 'pass';
    case 'failure':
      return 'failure';
    case 'timeout':
      return 'timeout';
    default:
      return 'unconfirmed';
  }
}

export function protocolDefault(
  requirements: PairProtocolRequirements,
  participantSlot: 1 | 2,
): ProtocolVerification {
  return (participantSlot === 1 ? requirements.hostUsesTurn : requirements.guestUsesTurn)
    ? 'not-tested'
    : 'not-applicable';
}

/** Rejects incompatible duplicate representations rather than discarding submitted evidence. */
export function validateAssessment(
  outcome: ProbeOutcome,
  assessment: Partial<ProbeAssessment>,
  requirements: PairProtocolRequirements,
  participantSlot: 1 | 2,
): ProbeAssessment | null {
  const inferredConnectivity = connectivityFromOutcome(outcome);
  const connectivity = assessment.connectivity ?? inferredConnectivity;
  const expectedProtocol = protocolDefault(requirements, participantSlot);
  const protocolVerification = assessment.protocolVerification ?? expectedProtocol;

  if (connectivity !== inferredConnectivity) return null;
  if (expectedProtocol === 'not-applicable' && protocolVerification !== 'not-applicable')
    return null;
  if (expectedProtocol !== 'not-applicable' && protocolVerification === 'not-applicable')
    return null;
  return { connectivity, protocolVerification };
}

export function aggregateAssessment(
  evidence: AssessmentEvidence[],
  requirements: PairProtocolRequirements,
): ProbeAssessment {
  const slots = new Set(evidence.map((result) => result.participantSlot));
  const connectivity: ConnectivityOutcome =
    evidence.length === 2 &&
    slots.size === 2 &&
    slots.has(1) &&
    slots.has(2) &&
    evidence.every((result) => result.connectivity === 'pass')
      ? 'pass'
      : evidence.some((result) => result.connectivity === 'failure')
        ? 'failure'
        : evidence.some((result) => result.connectivity === 'timeout')
          ? 'timeout'
          : 'unconfirmed';
  const requiredSlots = ([1, 2] as const).filter((slot) =>
    slot === 1 ? requirements.hostUsesTurn : requirements.guestUsesTurn,
  );
  const required = evidence.filter((result) => requiredSlots.includes(result.participantSlot));
  const eachRequiredSlotReportedOnce = requiredSlots.every(
    (slot) => required.filter((result) => result.participantSlot === slot).length === 1,
  );
  const protocolVerification: ProtocolVerification = !requiredSlots.length
    ? 'not-applicable'
    : required.some((result) => result.protocolVerification === 'mismatch')
      ? 'mismatch'
      : required.some((result) => result.protocolVerification === 'unavailable')
        ? 'unavailable'
        : eachRequiredSlotReportedOnce &&
            required.every((result) => result.protocolVerification === 'verified')
          ? 'verified'
          : 'not-tested';
  return { connectivity, protocolVerification };
}
