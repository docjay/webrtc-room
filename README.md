# WebRTC Room diagnostics

A local WebRTC data-channel diagnostic foundation. Run `npm install`, `npm run dev`, then open the printed localhost URL. Run preflight on each device before creating/joining a room. Default Azure and Google STUN checks are independent; completed probes unlock valid room controls even when network endpoints time out.

## Commands

- `npm run check` — formatting, strict TypeScript, lint, unit/integration tests, and production browser/Worker builds.
- `npm run test:browser` — Playwright Chromium UI and actual local `RTCPeerConnection` smoke scenarios.
- `npm run migrate:local` / `npm run reset:local` — create/reset the gitignored `.local-data/webrtc-room.sqlite` SQLite adapter used by the local Worker server. It implements the D1 repository interface for development only; production remains Worker D1.

`dist/client/` contains browser assets and `dist/server/index.js` is the Worker entrypoint. Production remains a Worker `fetch` handler backed by D1. Configure `DB`, `OWNER_ID`, and `ENVIRONMENT=production` only through hosting; no credentials belong in source. `x-dev-identity` is loopback development/test-only and production fails closed.

## Evidence limits

Local browser smoke evidence is not NAT traversal, TURN, external STUN reachability, hosted D1, or platform-owner verification. Standard browser APIs cannot guarantee forced ICE-TCP or a specific candidate pair; those profiles are shown as unsupported/inconclusive rather than passed.
