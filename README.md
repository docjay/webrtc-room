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

The local Git repository is initialized. The implementation plan is in [SPEC.md](SPEC.md); model routing, efficient-execution policy, and contributor instructions are in [AGENTS.md](AGENTS.md). Copilot build and later Codex hosting prompts are in [KICKOFF.md](KICKOFF.md); the runtime contract and transfer checklist are in [BUILD_HANDOFF.md](BUILD_HANDOFF.md). Application code, dependencies, hosting registration, and deployment have not been created yet. There is no GitHub remote.

## Next implementation steps

1. Copilot builds and tests the complete app locally, preserving Workers/D1 compatibility.
2. Copilot commits the implementation and writes HANDOFF.md with test evidence and remaining platform-specific work.
3. Codex reuses that implementation, finishes Sites/auth integration, and prepares deployment.
4. Publish to the agreed audience and verify hosted two-device behavior, including TURN when credentials are available.

Keep service credentials out of Git; configure production secrets through Sites.
