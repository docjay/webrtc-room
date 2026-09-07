# Status - UX redesign planned, implementation pending

## Current milestone - 2026-09-07

- User approved a room-first flow, diagnostics drawer closed by default, and
  automatic device checks with an in-app recheck.
- `UX_REDESIGN_PLAN.md` records layout sketches, probe correctness fixes,
  module/agent ownership, implementation order, and acceptance criteria.
- `SPEC.md` now requires automatic checks instead of a mandatory button click.
  `KICKOFF.md` contains the current fresh-session Sol implementation prompt.
- No application code or hosted configuration changed in this planning milestone.
  No new runtime/browser evidence is claimed. Source baseline: `4060f76`.
- Next action: a fresh Sol-medium session implements the plan using bounded,
  non-overlapping Terra lanes and one integration owner.
- Planning session model: Astra; no subagents or escalation investigation used.
  This does not change the intended Sol model for the implementation session.

## Historical build and hosting notes

The following entries predate the UX plan. Their deployment state and evidence
must be read with their dates; they are not current UX implementation results.

**Orchestration:** gpt-5.6-sol, medium. Terra medium implemented the bounded
foundation, application, protocol, and reviewed-defect slices. Luna medium ran
the narrow final validation and prepared the handoff. Sol medium performed the
focused read-only integration review. Astra was not used because no unresolved
blocker justified escalation.

## Completed

- Replaced the production fail-closed identity placeholder with the trusted
  Sites-dispatcher `oai-authenticated-user-id` integration. Production accepts
  no development identity header, and owner authorization remains server-side.
- Preserved the Worker-compatible default entry point and staged the existing
  versioned migrations into `dist/.openai/drizzle/` for Sites deployment,
  alongside `dist/server/index.js` and `dist/client/`.
- Created the private Sites project and persisted its project ID in hosting
  metadata. The platform has a logical `DB` binding declaration, production
  environment flag, and a secret, verified owner-only `OWNER_ID`; no identity
  value is stored in this repository.
- Saved a non-deployed Sites version from the packaged integration commit. Its
  archive was inspected and includes the Worker, client assets, binding
  metadata, and ordered `0001`/`0002` migrations.

- Replaced same-page RTC smoke with authenticated host/guest HTTP signaling, canonical host-issued attempt generations, sanitized two-device capability manifest, identical acknowledgements, generation/probe-isolated SDP/candidate exchange, and real paired ordered data channels.
- Matrix ranks mixed profiles by their weakest hop (direct UDP/STUN, TURN UDP, TURN TLS, TURN TCP, ICE-TCP), waits for better/equal terminal rows for deterministic selection, and retains at most one eligible passed channel per tier before closing losers.
- Replaced competing performance loops with a host-coordinated ordered-channel protocol: 20 unique RTT IDs, bounded unanswered accounting, sequential A→B/B→A receiver-measured goodput, 16 KiB chunks, backpressure, caps, cancellation, and visible per-direction metrics.
- Candidate signaling queues candidates until remote descriptions exist, treats permanent signaling errors as terminal evidence, and validates URL attempt identity against the active generation.
- Canonical attempt issuance uses conditional generation advancement; concurrent ordinary host requests return the same live generation, while `/retry` requires and links its predecessor.
- Added functional `/admin` route with explicit loopback-only developer identity entry, owner list/filter/detail/export, fail-closed states, and no implicit local owner. Local dev leaves `OWNER_ID` unset unless `LOCAL_OWNER_ID` is supplied.
- Added a local persistent SQLite/sql.js D1-compatible adapter behind the Worker repository interface. `migrate:local` and `reset:local` create/reset `.local-data/webrtc-room.sqlite`; production still requires Worker D1 and has no filesystem dependency.
- Added bounded local event uploads, run registration/attempt linking, main chat, automatic bounded post-matrix RTT/binary traffic, cancellation controls, exports, compact view, and a real two-context browser test against the local Worker.
- Repaired endpoint isolation: each sanitized URL has a credential-free stable endpoint ID; every matrix peer receives only its exact requested URL and TURN-side peers force `relay`. Selected-pair checks require side-specific relay type/relay protocol, STUN srflx/prflx evidence, and reject relay winners for direct rows.
- Repaired guest replacement with D1-batched stale guest capability/signal/ack/slot deletion, conditional claim, and conditional slot insertion. Departed credentials no longer authorize room access.
- Repaired config rerun retry semantics: configuration edits close active main/performance resources, invalidate preflight, increment a local suite generation, and have the host use explicit `/retry` with the prior attempt. Old attempt signal URLs are rejected after retry.
- Added versioned migration `0002_integrity_and_quotas.sql`; the local runner now applies ordered, unapplied migrations without resetting data. Cleanup is child-first and bounded. Event accounting now uses a conditional insert plus trigger, so counters follow only unique inserted rows under concurrent uploads.

## Verification — 2026-09-06, Chromium headless on macOS

- **2026-09-07 hosted publish:** public deployment succeeded after bundling the
  Worker schema runtime. Hosted health returned 200, room creation returned
  201, and the Sites D1 overview verified `DB` plus all nine expected tables.
  Signed-out and forged-client-header admin list/export calls returned 403.
  The platform access-policy account identifier did not match the opaque
  site-specific dispatcher identity, so the attempted owner request also
  returned 403. This is fail-closed and leaves no diagnostic data public, but
  requires a real authenticated owner-browser identity verification before
  owner administration can be claimed working.

- **2026-09-07 first hosted publish:** rejected before going live because the
  Worker archive left the `zod` schema runtime external. The Worker Vite build
  now bundles that runtime; the complete check suite passed after the fix. A
  replacement version is pending publication.

- **2026-09-07 Sites integration preflight:** `npm run check` passed (format,
  strict TypeScript, ESLint, 23 unit/integration tests, and Worker/client
  build); `npm run reset:local && npm run migrate:local` passed; the current
  Sites packager accepted the artifact with both migration files, the Worker,
  client assets, and `DB` binding metadata. Browser rerun and hosted validation
  remain pending platform registration.
- **2026-09-07 platform pre-deploy:** Sites accepted the source-backed,
  non-deployed version. The database overview intentionally exposes no binding
  before a deployment, so hosted D1 migration application and persistence
  cannot be truthfully verified without the still-required deployment
  authorization.
- **2026-09-07 browser rerun:** the real local Playwright smoke suite did not
  pass in this network state. Direct rows reached their 30-second data-channel
  deadlines and STUN rows were correctly inconclusive; no verified main channel
  was available for chat/performance assertions. Static/unit/integration and
  local migration checks still passed. This is not evidence of hosted or
  external-network connectivity.

- `npm run check` — passed: formatting, TypeScript, ESLint, 23 Vitest unit/integration tests, client and Worker builds.
- `npm run reset:local && npm run migrate:local` (twice) — passed; reset followed by ordered, idempotent migration application to `.local-data/webrtc-room.sqlite`.
- Restart durability — local Worker health check passed after build/restart; local SQLite/D1 adapter remains persistent across fresh adapter instances.
- `npm run test:browser` — passed: Playwright Chromium, three tests. Two isolated contexts completed preflight/create/join, shared `att_` ID, Worker-routed paired RTC data channel, bidirectional chat, all matrix rows terminal, visible receiver-measured A→B/B→A metrics, and a valid config rerun produced a different attempt ID and re-established the main path.
- Final source commit: `3e25063c977e3ba6b517c74e4141a8d7c8626e9c`.

## Remaining unavoidable limitations

- No supplied TURN credentials or external second network: STUN/TURN relay, NAT traversal, and TLS/TCP relay outcomes remain explicitly unverified/inconclusive.
- Standard browser WebRTC cannot force ICE-TCP or a chosen candidate pair; those rows are terminal unsupported/inconclusive rather than advertised as passes.
- Hosted owner configuration is complete, but the actual Sites D1 binding,
  migration application, and hosted authorization checks require the pending
  deployment; production remains fail-closed until the Sites dispatcher serves
  a request.
