# WebRTC Room: implementation specification

Status: proposed implementation plan, prepared for user review. No application implementation or deployment is authorized by this document alone.

## Purpose and scope

Build a two-device WebRTC data-channel demo with diagnostics before, during, and after connection, plus persistent owner-only diagnostic review. A host creates a room code/link; one guest joins. Both can exchange text messages, inspect the path, run performance probes, leave, and retry. This establishes a reusable foundation for later games or device tools. Audio/video, file transfer, game logic, and a custom account system are outside this version.

## ICE configuration and probes

- Default STUN: `stun:stun.azure.com:3478`, as requested. Its current operation must be validated; official Microsoft documentation establishing general public service support has not been located. No availability promise is assumed.
- Secondary public STUN: `stun:stun.l.google.com:19302`, used as a fallback when the primary probe yields no usable server-reflexive candidate. Report each result separately and permit editing/disabling endpoints. Browsers may contact multiple configured URLs concurrently; do not promise ordered failover inside ICE.
- STUN discovers mapped addresses; it is not a relay or a guarantee of connectivity.
- TURN is unconfigured initially. Each device may paste a JSON string with an `iceServers` array using standard `urls`, `username`, and `credential` fields. Support TURN UDP, optional plain TCP, and TLS over TCP. Example:

```json
{"iceServers":[{"urls":["turn:relay.example.com:3478?transport=udp","turn:relay.example.com:3478?transport=tcp","turns:relay.example.com:443?transport=tcp"],"username":"user","credential":"password"}]}
```

- TURN input augments configured STUN defaults. Validate schemes, ports, length, and structure; show a sanitized preview. Keep credentials in browser memory only, never in URLs, database records, exports, or browser persistent storage. Each device configures its own credentials.
- Preflight can run without a second device. Probe each STUN endpoint and each configured TURN URL independently with a disposable peer connection, bounded timer, and cleanup. Report candidate gathering/allocation independently from actual peer connectivity.
- Connection modes: automatic (all configured candidates) and relay-only. Individual TURN transport probes isolate each URL. End-to-end relay-only tests require relay configuration on both devices.
- Display direct UDP, observed ICE-TCP, TURN UDP/TCP/TLS evidence separately. Candidate `protocol` and TURN `relayProtocol` represent different hops. Preserve raw supported fields; label unavailable fields rather than guessing.

## Product surfaces

1. Room create/join controls, code/link, two participant slots, attempt ID, connection status, and leave/retry actions.
2. ICE configuration and preflight panel with per-check outcome and duration.
3. Live diagnostic timeline, candidate table, selected path, and stage timers.
4. Connected text-message demo and performance probe controls/results.
5. Copy text report, download JSON, and compact screenshot-friendly report view. Export remains usable after failure.
6. Owner review page: Sign in with ChatGPT, list/filter attempts by ID/date/outcome, inspect both devices' events, and download reports.

Responsive, keyboard-operable controls and screen-reader status updates are required. Auto-scrolling logs must not interrupt someone reviewing older entries. Transport details belong in the diagnostic view; core room controls stay simple.

## State, timers, and diagnostics

Use an explicit session state machine: idle, preflight, creating/joining, waiting-for-peer, signaling, checking, connected, disconnected, failed, closed. ICE gathering, signaling, data-channel, and probe states are separate because they overlap. Retries/reconnections have new attempt generations; no stale candidate may enter a new generation.

Every application operation emits start/end/outcome, elapsed milliseconds from a monotonic clock, and a wall-clock timestamp for correlation. Record HTTP latency/status, poll delays/retries, offer/answer creation and application, candidate send/receive/application, ICE transitions, data-channel open/close/error, stats collection, probe phases, and log-upload state. Show waiting duration distinctly from active network negotiation. Never subtract timestamps across devices as a latency measurement.

Candidate details: local/remote, host/srflx/prflx/relay, protocol, TCP type, address family, related address where exposed, source server, discovery time, and selected-pair association. Peer-reflexive candidates may appear only in stats. Account for mDNS address hiding and browser field omissions.

Inspect candidate pairs and transport/DTLS/SCTP state where exposed. Capture stats at major transitions and at a bounded live sampling interval (default one second during active measurement, five seconds otherwise). Missing values are unavailable, never zero. Bound history and sampling volume.

Diagnosis records contain evidence, severity, stage, and confidence: observed, suspected, unknown, or not tested. Cover invalid configuration, missing API, failed signaling, full/expired rooms, no peer answer, gathering timeout, server errors, no viable pair, negotiation errors, channel failure, network changes, and probe interruption. Preserve browser error codes and sanitized text. A STUN timeout/701 alone does not establish UDP blocking; gathering a candidate does not establish reachability. DNS, firewall, certificate, and authentication explanations are only asserted when evidence supports them; otherwise list possibilities.

NAT: report observed mapping/connectivity behavior and its limits. Do not claim reliable full-cone/restricted/symmetric classification from ordinary browser candidate gathering. Formal RFC 5780 behavior testing is outside the initial version. HTTPS reachability is not proof of TURN TCP/TLS availability.

Initial configurable limits: 10-second HTTP requests, 15-second per-server preflight probes, 30-second active connection deadline after both peers are ready, and rooms expiring after 15 minutes of inactivity. These are application deadlines, not declarations of network impossibility. Record browser tab visibility and timer throttling where observed.

## Performance measurement

Automatically run a bounded performance probe when the data channel opens; show the planned traffic budget before connecting, permit disabling automatic bandwidth testing, and provide cancel/rerun controls. The host coordinates phases so peers do not launch competing probes.

- Idle RTT: 20 application ping/pong samples at 100 ms spacing, with sender-local monotonic timestamps and bounded response deadlines. Show minimum, median, p95, maximum, sample count, and unanswered pings. Keep ongoing low-frequency RTT monitoring separately.
- ICE RTT: display `currentRoundTripTime` when available with its own label; it is a STUN connectivity/consent measurement, not application RTT.
- Throughput: sequential A-to-B and B-to-A tests, each at most 5 seconds or 8 MiB of payload, whichever comes first; at most 16 MiB total payload per run plus protocol overhead. Report if a cap, cancellation, visibility change, timeout, or connection change truncated measurement.
- Use a dedicated reliable ordered data channel and bounded binary chunks (at most 16 KiB and within negotiated message size), `bufferedAmount` backpressure, and cancellation. Receiver-measured bytes over receiver-local elapsed time determine delivered application goodput, not bytes merely queued by the sender. Specify warm-up/drain/measurement boundaries in protocol tests.
- Show each direction in Mbps, bytes received, measured duration, buffering, and RTT under load. Record channel settings and selected pair before/after; a changed path invalidates a stable-path summary.
- Label results short data-channel goodput, not ISP bandwidth or a guaranteed maximum. Browser `availableOutgoingBitrate` is an optional RTP estimate and must not substitute for data-channel measurement. Do not infer packet loss from reliable-channel ping timeouts or unavailable media stats.

## Attempt identity and persistent reports

D1 holds rooms, participant slots/token hashes, bounded signaling envelopes, connection attempts, diagnostic runs/events, and performance summaries. SQL schema uses versioned migrations and prepared queries.

- Generate a local `runId` before the first network operation so preflight/registration failures can be exported. Register it idempotently when the API is reachable.
- The server creates a shared `attemptId` for each paired connection generation; both devices receive it via signaling. Every persisted event has the shared attempt ID when known, local run ID, participant ID, sequence, event type/version, client time/elapsed time, and server receipt time.
- The visible/copyable attempt ID exactly matches the DB identifier. Before pairing, clearly display the local run ID instead; retain that association after pairing. Do not silently replace an offline identifier without recording the mapping.
- A retry or ICE restart gets a new shared attempt ID linked to its predecessor. Preflight-only, failed joins, and orphaned runs remain searchable under their run IDs.
- Log upload is append-only, schema-validated, bounded, batched, retried with backoff, and idempotent by run/sequence. Server derives identity from scoped write credentials, never trusts a submitted room/participant binding. Unknown event fields are rejected or stripped.
- Preserve all attempt summaries subject to a proposed 30-day retention default. Bound each run to 2 MiB/5,000 events; summarize repetitive polls/stats and explicitly record truncation. Apply endpoint quotas/rate limits and cleanup expired rows in bounded batches. Retention enforcement must work without assuming unsupported scheduled Workers features.
- Flush periodically and best-effort on page exit; retries must not interfere with WebRTC. Clearly show saved/pending/upload-failed/truncated status. A browser crash, offline network, or abrupt close can prevent upload: never promise every event is stored. Copy/download still works from the local buffer while the page remains open.

## Owner-only access and privacy

Use Sites Sign in with ChatGPT for `/admin` and server-side identity checks on EVERY diagnostic read/export endpoint. Successful sign-in alone is insufficient: compare the platform's stable site-specific user ID against an explicitly provisioned owner ID in hosted configuration. Fail closed when unset. Never use first visitor/first login as owner, client-supplied identity, a room code, or email alone as authorization. Resolve and verify the owner's platform identity during deployment setup.

Participants can read room signaling as needed and export their own in-memory report; they cannot retrieve stored reports, enumerate attempts, or read another participant's history. Attempt IDs are references, not read credentials. Scope and hash participant write/poll tokens; enforce origin/CSRF defenses as applicable. Public room access and private admin routes are distinct from the Site-wide access policy.

Sanitize diagnostic data before upload and again server-side. Exclude TURN credentials, access tokens, ICE passwords/ufrags, raw SDP, chat message bodies, and probe payloads. Persist structured allowlisted fields, normalized error categories, candidate types/transport/address family, and per-run address aliases rather than raw IP addresses or room codes. Raw SDP/candidates needed for signaling are a separate ephemeral, participant-authorized data path and expire promptly. Logs display untrusted text safely.

Tell participants succinctly that connection diagnostics are saved for the owner's troubleshooting, and expose retention/upload status. Owner-only means application access control, not that platform administrators or the underlying hosting provider cannot access infrastructure data.

## Component boundaries and guardrails

Use the Sites starter with TypeScript, D1 and auth support, preserving starter conventions. Keep:

- UI components: RoomControls, IceConfiguration, PreflightResults, ConnectionStatus, CandidateTable, DiagnosticTimeline, PerformancePanel, ReportExport, OwnerAttemptList/Detail.
- Domain modules: lifecycle reducer, IDs, message/event schemas, candidate/stats normalization, failure classification, timing, redaction, performance calculations.
- Browser adapters: WebRTC session, signaling HTTP client, ICE probes, performance controller, report buffer/uploader. Inject clock, RTC factory, transport, and ID source where needed for deterministic tests.
- Server modules: room/attempt services, authorization, signaling repository, diagnostics ingestion/query, quotas, retention; thin validated route handlers. Browser modules never import DB/auth secrets; UI does not execute SQL or negotiate ICE directly.

One `check` command runs formatting check, strict TypeScript (including unchecked-index and exact-optional checks where compatible), ESLint with typed no-floating-promises/no-misused-promises and hooks rules, import-boundary checks, unit/integration tests, and the production build. Prohibit unchecked `any`, blanket suppressions, and unvalidated network payloads. Lock dependencies; require reviewed exceptions and avoid broad cleanup unrelated to the task. Add a separate browser-test command and CI jobs when a CI remote is configured; local checks work without GitHub.

## Tests and acceptance

Unit/property tests: config validation, redaction including nested/free-text secret leakage, evidence labels, incomplete stats, state transitions/cancellation, monotonic timings, percentile/goodput math, backpressure, upload bounds, duplicate/stale signals, report ID consistency.

D1 integration tests: atomic second-slot claim under concurrent joins, room expiry, attempt generation isolation, cursor polling/order/idempotency, append-only logs, ingestion quotas/truncation, retention cleanup, malformed/oversized inputs, and authorization. Assert signed-out and signed-in non-owner requests cannot list/read/export logs, guessed IDs grant no access, missing owner configuration fails closed, spoofed client identity fails, and write tokens cannot retrieve reports.

Browser tests: two isolated contexts using actual WebRTC connect and exchange data, preflight views, state/timer visibility, report copy/download and matching IDs, interrupted signaling/retries, peer leave/restart, performance cancel/completion/bounds, mobile layout, keyboard access, and screenshot-friendly reports. Test bounded real throughput without requiring minimum internet speed; use deterministic fixtures for exact calculations. Browser testing is explicitly in scope.

Controlled network acceptance: actual different-device/different-network connection; TURN UDP, TCP, and TLS paths independently verified using supplied test credentials; relay-only path confirmed in stats; invalid TURN credentials, unreachable server, and UDP-blocked/TLS-success case where an appropriate network environment is available. Local two-tab tests do not prove NAT traversal. Mark any unavailable transport test unverified, never passed. No TURN service is provisioned by default.

Release acceptance: demo works; all three diagnostic phases are usable; performance results are accurately labeled; both clients and stored reports share IDs; unauthorized retrieval is denied; secrets never enter reports; checks pass; remaining external-network limitations are documented.

## Implementation sequence and delegation

1. Root orchestrator owns Sites lifecycle, scaffolding, checkout edits, integration, source/version/deployment operations, and final validation. First settle this spec with the user.
2. Establish module contracts, schemas, static checks and test harness; then implement room/signaling and a minimal data-channel path.
3. Add diagnostics/preflight/export and persistent owner-authorized reports.
4. Add RTT/goodput probes and failure/reconnection handling.
5. Complete automated checks, browser tests, and available network acceptance before deployment handoff.

Use Terra mostly for bounded architecture/protocol/security reviews and patch proposals; Luna for focused fixtures/test-case reviews; Sol for difficult cross-module debugging or independent final review when needed. Sites skill constraints reserve Site checkout edits and all Sites tools to the root owner: subagents return reviews/proposed patches for root integration rather than concurrently editing the Site or deploying. The orchestrator remains responsible for evidence and does not accept passing mocks as proof of real networking.

## Sources

- https://webrtc.org/getting-started/peer-connections — signaling, STUN configuration and ICE.
- https://www.rfc-editor.org/rfc/rfc8835.html — ICE-TCP and TURN UDP/TCP/TLS transport distinctions.
- https://www.w3.org/TR/webrtc-stats/ — candidate-pair RTT, selected transports and optional RTP bitrate estimates.
- https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/icecandidateerror_event — ICE server errors and limitations.
- https://www.rfc-editor.org/rfc/rfc5780.html — NAT behavior discovery scope.
- Installed Sites authentication and persistence documentation — D1, forwarded site-specific identity, and dispatch-owned Sign in with ChatGPT.
