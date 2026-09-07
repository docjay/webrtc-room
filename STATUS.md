# Status — local build complete

**Orchestration:** gpt-5.6-sol, medium. Terra medium implemented the bounded
foundation, application, protocol, and reviewed-defect slices. Luna medium ran
the narrow final validation and prepared the handoff. Sol medium performed the
focused read-only integration review. Astra was not used because no unresolved
blocker justified escalation.

## Completed

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

- `npm run check` — passed: formatting, TypeScript, ESLint, 23 Vitest unit/integration tests, client and Worker builds.
- `npm run reset:local && npm run migrate:local` (twice) — passed; reset followed by ordered, idempotent migration application to `.local-data/webrtc-room.sqlite`.
- Restart durability — local Worker health check passed after build/restart; local SQLite/D1 adapter remains persistent across fresh adapter instances.
- `npm run test:browser` — passed: Playwright Chromium, three tests. Two isolated contexts completed preflight/create/join, shared `att_` ID, Worker-routed paired RTC data channel, bidirectional chat, all matrix rows terminal, visible receiver-measured A→B/B→A metrics, and a valid config rerun produced a different attempt ID and re-established the main path.
- Final source commit: `3e25063c977e3ba6b517c74e4141a8d7c8626e9c`.

## Remaining unavoidable limitations

- No supplied TURN credentials or external second network: STUN/TURN relay, NAT traversal, and TLS/TCP relay outcomes remain explicitly unverified/inconclusive.
- Standard browser WebRTC cannot force ICE-TCP or a chosen candidate pair; those rows are terminal unsupported/inconclusive rather than advertised as passes.
- Hosted Sites identity/owner configuration and actual Cloudflare D1 binding require Codex platform setup; production authorization remains fail-closed until configured.
