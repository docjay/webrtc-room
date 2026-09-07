# WebRTC Room

Local project preparation for a two-device WebRTC app hosted with Sites.

## Intended first version

- One device creates a room and receives a room code.
- A second device joins with that code.
- Sites HTTP endpoints and D1 exchange connection offers, answers, and ICE candidates.
- A WebRTC data channel carries messages after connection.
- Rooms expire and admit at most two participants.
- An external TURN service provides relay coverage where direct connections fail.

## Current status

The local Git repository is initialized. The implementation plan is in [SPEC.md](SPEC.md); model routing, cost policy, and contributor instructions are in [AGENTS.md](AGENTS.md). Application code, dependencies, hosting registration, and deployment have not been created yet. There is no GitHub remote.

## Next implementation steps

1. Scaffold the Sites app with D1 support.
2. Implement room creation, joining, signaling, and a minimal data-channel demo.
3. Validate locally, then deploy and verify with two devices.
4. Configure TURN for reliable connections across restrictive networks.

Keep service credentials out of Git; configure production secrets through Sites.
