# WebRTC Room: implementation specification

Status: implementation specification. Primary implementation runs locally in Copilot; Sites integration and deployment return to Codex. A kickoff request authorizes local implementation. This document alone does not authorize publication.

## Purpose and scope

Build a two-device WebRTC data-channel demo with diagnostics before, during, and after connection, plus persistent owner-only diagnostic review. A host creates a room code/link; one guest joins. Both can exchange text messages, inspect the path, run performance probes, leave, and retry. This establishes a reusable foundation for later games or device tools. Audio/video, file transfer, game logic, and a custom account system are outside this version.

## ICE configuration and probes

- Default STUN: `stun:stun.azure.com:3478`, as requested. Its current operation must be validated; official Microsoft documentation establishing general public service support has not been located. No availability promise is assumed.
- Secondary public STUN: `stun:stun.l.google.com:19302`, tested independently alongside Azure on every diagnostic run, and available as a fallback for connection setup. Report each result separately and permit editing/disabling endpoints. Browsers may contact multiple configured URLs concurrently; do not promise ordered failover inside ICE.
- STUN discovers mapped addresses; it is not a relay or a guarantee of connectivity.
- TURN is unconfigured initially. Each device may paste a JSON string with an `iceServers` array using standard `urls`, `username`, and `credential` fields. Support TURN UDP, optional plain TCP, and TLS over TCP. Example:

```json
{"iceServers":[{"urls":["turn:relay.example.com:3478?transport=udp","turn:relay.example.com:3478?transport=tcp","turns:relay.example.com:443?transport=tcp"],"username":"user","credential":"password"}]}
```

- TURN input augments configured STUN defaults. Validate schemes, ports, length, and structure; show a sanitized preview. Keep credentials in browser memory only, never in URLs, database records, exports, or browser persistent storage. Each device configures its own credentials.
- Preflight can run without a second device. Probe each STUN endpoint and each configured TURN URL independently with a disposable peer connection, bounded timer, and cleanup. Report candidate gathering/allocation independently from actual peer connectivity.
- The default connection policy and automatic matrix are defined below. Individual TURN probes isolate each URL. Tests requiring a relay on both devices require both devices to configure TURN; one-sided relay tests are distinct and use only the required side's credentials.
- Display direct UDP, observed ICE-TCP, TURN UDP/TCP/TLS evidence separately. Candidate `protocol` and TURN `relayProtocol` represent different hops. Preserve raw supported fields; label unavailable fields rather than guessing.

## Required diagnostics and automatic connectivity matrix

Page load performs passive browser/API/secure-context checks and initializes a local run only. The user must click Run diagnostics before Create room or Join room is enabled on EACH device, including visitors opening a join link. Preflight runs all configured STUN and TURN endpoint probes, with no throughput traffic. Prerequisite means completed, not every network test passed: failed/timed-out network checks are valuable evidence and do not bar an otherwise possible connection. Missing WebRTC support or invalid required configuration blocks continuation; an unavailable signaling service explains why room actions cannot succeed. Cancelled/incomplete preflight does not unlock room actions. Changing ICE configuration or observing a network change invalidates preflight and requires a rerun; offer a manual rerun for undetectable changes.

Once both peers join and are ready, automatically schedule the full configured connectivity matrix without an additional button. A successful connection MUST NOT cancel the remaining tests. Distinguish Main connection ready from Diagnostics complete, and show completed/total/running/queued test counts.

STUN is a discovery mechanism, not a separate media/data transport. Matrix distinguishes endpoint STUN response/mapping discovery, host-only direct UDP, STUN-assisted direct UDP with no TURN, direct ICE-TCP, and TURN-assisted paths. For STUN-assisted tests isolate each configured STUN endpoint profile; report the actual selected host/srflx/prflx pair. If a host path wins, that does not establish that a srflx path worked. Candidate-constrained testing must be verified; inability to isolate a path is inconclusive/unsupported, never success under another label.

Enumerate a manifest from BOTH devices' sanitized endpoint capabilities, without sharing TURN secrets: direct profiles plus one-sided A relay, one-sided B relay, and two-sided relay combinations for configured UDP/TCP/TLS URLs. Include mixed relay transports (e.g. A TLS to B UDP) as separate rows. Deduplicate exact equivalent profiles; present grouped summaries with expandable endpoint/pair detail. Each declared configured combination gets a terminal result, including not configured, unsupported, inconclusive, cancelled, and timeout; do not silently omit combinations. "Full" means this declared test matrix, not every possible local interface, IP address, port, or undocumented browser path. Browser ICE may prune candidates or hide interfaces. Record all exposed candidates and checks and explicitly describe that coverage boundary.

Both peers must acknowledge the same server-issued test manifest before any paired probe starts; late/duplicate messages are idempotent and cannot resurrect a cancelled row. Each matrix row uses its own peer connection on each device, probe ID, signaling namespace, deadline, endpoint/candidate policy, selected-pair verification, and bidirectional application ping exchange. Candidate generation/allocation, successful ICE checks, opened data channel, and verified application traffic are separate milestones. A relay allocation alone does not pass a connectivity row. Per-row stats must verify the requested path on both ends where available; unavailable proof yields inconclusive. Do not rely on undocumented SDP priority rewriting. Standard browser APIs do not guarantee forcing direct ICE-TCP or a specific candidate pair. Add an early feasibility test for these constraints before building the policy scheduler; record unsupported isolation explicitly rather than substituting a host/UDP winner for TCP proof. A browser limitation is a valid diagnostic result, not permission to omit the row.

Launch matrix connectivity probes automatically with bounded concurrency (initially three peer-connection pairs at once) to reduce test interference and browser/server resource exhaustion. Every profile is scheduled immediately but queued work starts when capacity is available. Show queue time separately from execution duration. Retain only a small bounded set of policy candidates for the main channel; close completed temporary connections after results are captured. The scheduler must account for retained peers in its resource budget and avoid deadlock. Tests continue if the main peer connection fails, as long as HTTP signaling remains available; probe signaling does not depend on the main data channel.

Accepted application preference: direct UDP, TURN over UDP, TURN over TLS/TCP, then direct ICE-TCP. This is a product policy, not a claim of universal performance superiority. Qualify one-sided and mixed relay routes by the weakest transport hop (any TCP/TLS hop is in that tier). TLS precedes plain TURN TCP when otherwise equivalent. Any policy tie is deterministic and logged. A lower-tier fast result cannot displace a higher-tier success; eligibility waits until higher-tier tests reach terminal outcomes/deadlines. Apply the existing 30-second deadline per RUNNING connectivity profile, not to the entire matrix. A passed profile supplies evidence for choosing/retaining the main connection; if rebuilding is necessary, separately time it and reverify the selected route rather than assuming the same path. Do not silently advertise strict ordering if a browser cannot enforce the required constraints. Expose partial coverage/unsupported modes, and verify this policy in browser acceptance tests.

Connectivity probes run concurrently, but bandwidth measurements do not. Record per-profile setup and ping RTT during the matrix and label them concurrent-probe measurements. Once all connectivity rows finish, obtain a clean baseline and automatically run the bounded RTT/goodput test on the main selected path. Maintain the connected text demo while waiting. For this version, full automatic coverage means connectivity verification for every configured row; per-alternative bandwidth benchmarks remain a separate explicit action, sequential and bounded. Never call concurrent-probe RTT an unloaded baseline. Failure/cancellation of one row does not erase others; cancellation of the suite preserves a partial report.

## One report with correlated test tracks

Present ONE report per shared attempt, with nested device/preflight, room/signaling, connectivity-profile, main-session, performance, and upload tracks. The UI offers a merged timeline, per-test filters, an expandable matrix, and a timing waterfall. Copy/export defaults to the complete LOCAL report, not only a selected filter. Owners retrieve a merged report of both devices from D1; participants cannot retrieve the other device's persisted report. Reports clearly list missing/pending remote records. A participant screenshot and the owner report share the same attempt ID after pairing; pre-pair run IDs remain linked/searchable.

Add `probeId`, `peerConnectionId`, `spanId`, `parentSpanId`, configuration-version identifier, and per-device sequence numbers to the event model. Never put credentials or reversible credential hashes into configuration identifiers. Server-owned test manifests and scoped participant credentials constrain valid probe identities. Each message includes attempt generation and probe identity so ICE/SDP from concurrent tests cannot cross-contaminate another connection. Rerunning a profile creates a new probe ID with a link to the previous result.

Timers include queued time, active duration, gathering, signaling, connectivity checks, data-channel setup, ping round-trip, throughput, main-selection wait, total suite wall time, and report-upload completion. Report overlapping spans as overlapping; do not sum parallel test durations as wall-clock total. Use monotonic local clocks for durations, server receipt timestamps and message correlation for causal ordering across devices, and explicitly approximate merged cross-device display ordering. Do not calculate one-way network latency from unsynchronized clocks. Timeouts mean this profile did not complete within the recorded deadline, not permanent transport impossibility.

Keep summary/milestone/failure records for EVERY scheduled test in a reserved bounded summary budget; sample repetitive poll/stats details first. If raw-detail limits are reached, explicitly mark dropped counts and time windows. No summary may disappear silently. Persist partial reports continuously, including preflight failures, instead of waiting for the whole matrix. DB events are structured rows backing one logical report, not separate user-facing log files.

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

Initial configurable limits: 10-second HTTP requests, 15-second per-server preflight probes, 30-second execution deadline per active connectivity profile after both peers are ready, and rooms expiring after 15 minutes of inactivity. These are application deadlines, not declarations of network impossibility. Record browser tab visibility and timer throttling where observed.

## Performance measurement

Automatically run a bounded performance probe on the main channel after the connectivity matrix finishes; show the planned traffic budget before connecting, permit disabling automatic bandwidth testing, and provide cancel/rerun controls. The host coordinates phases so peers do not launch competing probes.

- Idle RTT: 20 application ping/pong samples at 100 ms spacing, with sender-local monotonic timestamps and bounded response deadlines. Show minimum, median, p95, maximum, sample count, and unanswered pings. Keep ongoing low-frequency RTT monitoring separately.
- ICE RTT: display `currentRoundTripTime` when available with its own label; it is a STUN connectivity/consent measurement, not application RTT.
- Throughput: sequential A-to-B and B-to-A tests, each at most 5 seconds or 8 MiB of payload, whichever comes first; at most 16 MiB total payload per run plus protocol overhead. Report if a cap, cancellation, visibility change, timeout, or connection change truncated measurement.
- Use a dedicated reliable ordered data channel and bounded binary chunks (at most 16 KiB and within negotiated message size), `bufferedAmount` backpressure, and cancellation. Receiver-measured bytes over receiver-local elapsed time determine delivered application goodput, not bytes merely queued by the sender. Specify warm-up/drain/measurement boundaries in protocol tests.
- Show each direction in Mbps, bytes received, measured duration, buffering, and RTT under load. Record channel settings and selected pair before/after; a changed path invalidates a stable-path summary.
- Label results short data-channel goodput, not ISP bandwidth or a guaranteed maximum. Browser `availableOutgoingBitrate` is an optional RTP estimate and must not substitute for data-channel measurement. Do not infer packet loss from reliable-channel ping timeouts or unavailable media stats.

## Attempt identity and persistent reports

D1 holds rooms, participant slots/token hashes, bounded signaling envelopes, connection attempts, diagnostic runs/events, and performance summaries. SQL schema uses versioned migrations and prepared queries.

- Generate a local `runId` before the first network operation so preflight/registration failures can be exported. Register it idempotently when the API is reachable.
- The server creates a shared `attemptId` for each paired connection generation; both devices receive it via signaling. Every persisted event has the shared attempt ID when known, local run ID, participant ID, probe/span identity when applicable, sequence, event type/version, client time/elapsed time, and server receipt time.
- The visible/copyable attempt ID exactly matches the DB identifier. Before pairing, clearly display the local run ID instead; retain that association after pairing. Do not silently replace an offline identifier without recording the mapping.
- A retry or ICE restart gets a new shared attempt ID linked to its predecessor. Preflight-only, failed joins, and orphaned runs remain searchable under their run IDs.
- Log upload is append-only, schema-validated, bounded, batched, retried with backoff, and idempotent by run/sequence. Server derives identity from scoped write credentials, never trusts a submitted room/participant binding. Unknown event fields are rejected or stripped.
- Preserve all attempt summaries subject to a proposed 30-day retention default. Bound detailed events in each run to 2 MiB/5,000 events; reserve separate bounded manifest/summary storage for each scheduled profile, summarize repetitive polls/stats and explicitly record truncation. Bound configuration input to at most three STUN and six TURN URLs per device and deduplicate them, so matrix summaries remain bounded; reject larger inputs clearly rather than silently dropping paths. Apply endpoint quotas/rate limits and cleanup expired rows in bounded batches. Retention enforcement must work without assuming unsupported scheduled Workers features.
- Flush periodically and best-effort on page exit; retries must not interfere with WebRTC. Clearly show saved/pending/upload-failed/truncated status. A browser crash, offline network, or abrupt close can prevent upload: never promise every event is stored. Copy/download still works from the local buffer while the page remains open.

## Owner-only access and privacy

Use Sites Sign in with ChatGPT for `/admin` and server-side identity checks on EVERY diagnostic read/export endpoint. Successful sign-in alone is insufficient: compare the platform's stable site-specific user ID against an explicitly provisioned owner ID in hosted configuration. Fail closed when unset. Never use first visitor/first login as owner, client-supplied identity, a room code, or email alone as authorization. Resolve and verify the owner's platform identity during deployment setup.

Participants can read room signaling as needed and export their own in-memory report; they cannot retrieve stored reports, enumerate attempts, or read another participant's history. Attempt IDs are references, not read credentials. Scope and hash participant write/poll tokens; enforce origin/CSRF defenses as applicable. Public room access and private admin routes are distinct from the Site-wide access policy.

Sanitize diagnostic data before upload and again server-side. Exclude TURN credentials, access tokens, ICE passwords/ufrags, raw SDP, chat message bodies, and probe payloads. Persist structured allowlisted fields, normalized error categories, candidate types/transport/address family, and per-run address aliases rather than raw IP addresses or room codes. Raw SDP/candidates needed for signaling are a separate ephemeral, participant-authorized data path and expire promptly. Logs display untrusted text safely.

Tell participants succinctly that connection diagnostics are saved for the owner's troubleshooting, and expose retention/upload status. Owner-only means application access control, not that platform administrators or the underlying hosting provider cannot access infrastructure data.

## Component boundaries and guardrails

Target the Sites-compatible TypeScript/Workers stack described in BUILD_HANDOFF.md. Copilot should reuse an available Sites starter locally with D1 and auth support, preserving conventions; if platform-specific tooling is unavailable, implement the same runtime boundaries and all independent product work without inventing platform integrations. Keep:

- UI components: RoomControls, IceConfiguration, PreflightResults, ConnectionStatus, CandidateTable, DiagnosticTimeline, PerformancePanel, ReportExport, OwnerAttemptList/Detail.
- Domain modules: lifecycle reducer, IDs, message/event schemas, candidate/stats normalization, failure classification, timing, redaction, performance calculations.
- Browser adapters: WebRTC session, signaling HTTP client, ICE probes, performance controller, report buffer/uploader. Inject clock, RTC factory, transport, and ID source where needed for deterministic tests.
- Server modules: room/attempt services, authorization, signaling repository, diagnostics ingestion/query, quotas, retention; thin validated route handlers. Browser modules never import DB/auth secrets; UI does not execute SQL or negotiate ICE directly.

One `check` command runs formatting check, strict TypeScript (including unchecked-index and exact-optional checks where compatible), ESLint with typed no-floating-promises/no-misused-promises and hooks rules, import-boundary checks, unit/integration tests, and the production build. Prohibit unchecked `any`, blanket suppressions, and unvalidated network payloads. Lock dependencies; require reviewed exceptions and avoid broad cleanup unrelated to the task. Add a separate browser-test command and CI jobs when a CI remote is configured; local checks work without GitHub.

## Tests and acceptance

Unit/property tests: config validation, redaction including nested/free-text secret leakage, evidence labels, incomplete stats, state transitions/cancellation, monotonic timings, percentile/goodput math, backpressure, upload bounds, duplicate/stale signals, report ID consistency.

D1 integration tests: atomic second-slot claim under concurrent joins, room expiry, attempt generation isolation, cursor polling/order/idempotency, append-only logs, ingestion quotas/truncation, retention cleanup, malformed/oversized inputs, and authorization. Assert signed-out and signed-in non-owner requests cannot list/read/export logs, guessed IDs grant no access, missing owner configuration fails closed, spoofed client identity fails, and write tokens cannot retrieve reports.

Browser tests additionally verify mandatory completed preflight on both devices and join links; failed network probes do not block otherwise viable joining; configuration changes invalidate results; all configured matrix rows complete even after an early winner; concurrent signals stay isolated; probe timeouts exclude queue time; higher-tier success beats earlier lower-tier success; no throughput overlaps matrix load; summaries survive raw-log truncation; copied reports include the full local run and stable correlation IDs.

Browser tests: two isolated contexts using actual WebRTC connect and exchange data, preflight views, state/timer visibility, report copy/download and matching IDs, interrupted signaling/retries, peer leave/restart, performance cancel/completion/bounds, mobile layout, keyboard access, and screenshot-friendly reports. Test bounded real throughput without requiring minimum internet speed; use deterministic fixtures for exact calculations. Browser testing is explicitly in scope.

Controlled network acceptance: actual different-device/different-network connection; TURN UDP, TCP, and TLS paths independently verified using supplied test credentials; relay-only path confirmed in stats; invalid TURN credentials, unreachable server, and UDP-blocked/TLS-success case where an appropriate network environment is available. Local two-tab tests do not prove NAT traversal. Mark any unavailable transport test unverified, never passed. No TURN service is provisioned by default.

Release acceptance: demo works; all three diagnostic phases are usable; performance results are accurately labeled; both clients and stored reports share IDs; unauthorized retrieval is denied; secrets never enter reports; checks pass; remaining external-network limitations are documented.

## Implementation sequence and delegation

Model routing and efficient-execution policy are maintained in AGENTS.md. Copilot performs the local build using appropriate subscription-available models; Codex model names are not requirements for Copilot. When work returns to Codex, Terra orchestrates by default, Luna handles narrow tasks, Sol handles targeted escalations/reviews, and Astra is reserved for justified exceptional escalations. There are no user-imposed session/token budgets or allowance checkpoints. Complete the full scope and validation while avoiding unnecessary model expense and duplicated work. Purchases, billing changes, reset redemption, and paid external-service provisioning still require user authorization. KICKOFF.md contains separate Copilot build and Codex hosting prompts; BUILD_HANDOFF.md defines the boundary and required handoff evidence. These agent-usage changes do not alter application safety limits such as probe traffic caps, timeouts, log bounds, and retention.

1. Copilot owns local scaffolding, source implementation, integration and available validation. Preserve the accepted scope and resolve only material remaining decisions. Codex later owns the actual Sites lifecycle and hosting operations.
2. Establish module contracts, schemas, static checks and test harness; then implement room/signaling and a minimal data-channel path.
3. Add diagnostics/preflight/export and persistent owner-authorized reports.
4. Add RTT/goodput probes and failure/reconnection handling.
5. Copilot completes automated checks, browser tests and available network acceptance, then writes an evidence-backed HANDOFF.md per BUILD_HANDOFF.md. Codex verifies the handoff, finishes platform-specific integration, checks the hosted runtime, and deploys only within the user-authorized access scope.

Use the model roles in AGENTS.md for the current provider. Copilot should perform as much local work as possible and must not require unavailable Codex tools. During the later Codex Sites phase, Sites skill constraints reserve Site checkout edits and all Sites tools to the root owner: subagents return reviews/proposed patches for root integration rather than concurrently editing the Site or deploying. The orchestrator remains responsible for evidence and does not accept passing mocks as proof of real networking.

## Sources

- https://webrtc.org/getting-started/peer-connections — signaling, STUN configuration and ICE.
- https://www.rfc-editor.org/rfc/rfc8835.html — ICE-TCP and TURN UDP/TCP/TLS transport distinctions.
- https://www.w3.org/TR/webrtc-stats/ — candidate-pair RTT, selected transports and optional RTP bitrate estimates.
- https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/icecandidateerror_event — ICE server errors and limitations.
- https://www.rfc-editor.org/rfc/rfc5780.html — NAT behavior discovery scope.
- Installed Sites authentication and persistence documentation — D1, forwarded site-specific identity, and dispatch-owned Sign in with ChatGPT.
