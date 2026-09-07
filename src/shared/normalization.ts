export function normalizeCandidate(candidate: Record<string, unknown>) {
  const type = ['host', 'srflx', 'prflx', 'relay'].includes(String(candidate.candidateType))
    ? String(candidate.candidateType)
    : 'unavailable';
  const protocol = ['udp', 'tcp'].includes(String(candidate.protocol))
    ? String(candidate.protocol)
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
    relatedAddress: typeof candidate.relatedAddress === 'string' ? 'available' : 'unavailable',
  };
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
