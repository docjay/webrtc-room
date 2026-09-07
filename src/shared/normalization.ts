export type CandidateEvidence = {
  type: 'host' | 'srflx' | 'prflx' | 'relay' | 'unavailable';
  protocol: 'udp' | 'tcp' | 'unavailable';
  addressFamily: 'mdns' | 'ipv4' | 'ipv6' | 'unavailable';
  tcpType: string;
  relayProtocol: string;
  relatedAddress: 'available' | 'unavailable';
};

function normalizeCandidateFields(candidate: {
  type?: unknown;
  protocol?: unknown;
  address?: unknown;
  tcpType?: unknown;
  relayProtocol?: unknown;
  relatedAddress?: unknown;
}): CandidateEvidence {
  const type = ['host', 'srflx', 'prflx', 'relay'].includes(String(candidate.type))
    ? (String(candidate.type) as CandidateEvidence['type'])
    : 'unavailable';
  const protocol = ['udp', 'tcp'].includes(String(candidate.protocol))
    ? (String(candidate.protocol) as CandidateEvidence['protocol'])
    : 'unavailable';
  const address = typeof candidate.address === 'string' ? candidate.address : '';
  return {
    type,
    protocol,
    addressFamily: address.endsWith('.local')
      ? 'mdns'
      : address.includes(':')
        ? 'ipv6'
        : address
          ? 'ipv4'
          : 'unavailable',
    tcpType: typeof candidate.tcpType === 'string' ? candidate.tcpType : 'unavailable',
    relayProtocol:
      typeof candidate.relayProtocol === 'string' ? candidate.relayProtocol : 'unavailable',
    relatedAddress: typeof candidate.relatedAddress === 'string' ? 'available' : 'unavailable',
  };
}

/** Normalize the browser RTCIceCandidate surface, not candidate.toJSON(). */
export function normalizeRtcIceCandidate(candidate: {
  type?: unknown;
  protocol?: unknown;
  address?: unknown;
  tcpType?: unknown;
  relayProtocol?: unknown;
  relatedAddress?: unknown;
}): CandidateEvidence {
  return normalizeCandidateFields(candidate);
}

/** Normalize an RTCStats local/remote candidate record. */
export function normalizeCandidateStats(candidate: {
  candidateType?: unknown;
  protocol?: unknown;
  address?: unknown;
  tcpType?: unknown;
  relayProtocol?: unknown;
  relatedAddress?: unknown;
}): CandidateEvidence {
  return normalizeCandidateFields({
    type: candidate.candidateType,
    protocol: candidate.protocol,
    address: candidate.address,
    tcpType: candidate.tcpType,
    relayProtocol: candidate.relayProtocol,
    relatedAddress: candidate.relatedAddress,
  });
}

/** @deprecated Use normalizeRtcIceCandidate or normalizeCandidateStats explicitly. */
export function normalizeCandidate(candidate: Record<string, unknown>): CandidateEvidence {
  return normalizeCandidateStats(candidate);
}
export function classifyFailure(stage: string, message: string) {
  const known = /timeout|denied|full|expired|network|negotiat|channel/i.exec(message)?.[0];
  return {
    stage,
    severity: known ? 'error' : 'warning',
    confidence: known ? 'observed' : 'unknown',
    message: message.slice(0, 500),
  };
}
