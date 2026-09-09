# WebRTC Room diagnostics

A local WebRTC data-channel diagnostic foundation. Run `npm install`, `npm run dev`, then open the printed localhost URL. Run preflight on each device before creating/joining a room. The default Cloudflare STUN endpoint is checked independently; completed probes unlock valid room controls even when network endpoints time out.

## Commands

- `npm run check` — formatting, strict TypeScript, lint, unit/integration tests, and production browser/Worker builds.
- `npm run test:browser` — Playwright Chromium UI and actual local `RTCPeerConnection` smoke scenarios.
- `npm run migrate:local` / `npm run reset:local` — create/reset the gitignored `.local-data/webrtc-room.sqlite` SQLite adapter used by the local Worker server. It implements the D1 repository interface for development only; production remains Worker D1.

`dist/client/` contains browser assets and `dist/server/index.js` is the Worker entrypoint. Production remains a Worker `fetch` handler backed by D1. Configure `DB`, `OWNER_ID`, and `ENVIRONMENT=production` only through hosting; no credentials belong in source. `x-dev-identity` is loopback development/test-only and production fails closed.

## Optional Xirsys TURN

The Worker can exchange a shared diagnostic access code for temporary Xirsys
TURN credentials after room participant authorization. Configure all four
runtime values; if any are absent, managed TURN fails closed and the app
continues with direct/STUN diagnostics:

```sh
XIRSYS_IDENT='<xirsys-ident>' \
XIRSYS_SECRET='<xirsys-secret>' \
XIRSYS_CHANNEL='<xirsys-channel>' \
DIAGNOSTIC_ACCESS_CODE='<six-or-more-random-characters>' \
npm run dev
```

Never commit these values. Use a randomly generated access code of at least six
characters. In production, configure all values as hosted runtime
secrets/settings. The Xirsys secret and shared access code stay server-side;
authorized browsers receive only temporary TURN credentials. TURN paths skip
all speed-check traffic.

## Evidence limits

Local browser smoke evidence is not NAT traversal, TURN, external STUN reachability, hosted D1, or platform-owner verification. Standard browser APIs cannot guarantee forced ICE-TCP or a specific candidate pair; those profiles are shown as unsupported/inconclusive rather than passed.
