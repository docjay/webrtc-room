# WebRTC Room: implementation specification

Status: implementation specification. Primary implementation runs locally in Copilot; Sites integration and deployment return to Codex. A kickoff request authorizes local implementation. This document alone does not authorize publication.

## Purpose and scope

Build a two-device WebRTC data-channel demo with diagnostics before, during, and after connection, plus persistent owner-only diagnostic review. A host creates a room code/link; one guest joins. Both can exchange text messages, inspect the path, run performance probes, leave, and retry. This establishes a reusable foundation for later games or device tools. Audio/video, file transfer, game logic, and a custom account system are outside this version.

## ICE configuration and probes

- Default public STUN: `stun:stun.cloudflare.com:3478`. Cloudflare documents this STUN service as free and unlimited. Label each device check and matrix hop with its credential-free server address so failures map to the exact configured endpoint. Permit editing/disabling endpoints through advanced configuration. Browsers may contact multiple configured custom URLs concurrently; do not promise ordered failover inside ICE.
- STUN discovers mapped addresses; it is not a relay or a guarantee of connectivity.
- TURN is unconfigured unless the hosted runtime supplies Xirsys integration secrets. When configured, each participant may enter the provider-neutral shared TURN access code on the primary room surface; only an already-authorized room participant can exchange it through the Worker for temporary Xirsys credentials. The long-term Xirsys ident, secret, channel, and diagnostic access code remain server-side. Each device may alternatively paste a JSON string with an `iceServers` array using standard `urls`, `username`, and `credential` fields. Support TURN UDP, optional plain TCP, and TLS over TCP. Example:

```json
{
  "iceServers": [
    {
      "urls": [
        "turn:relay.example.com:3478?transport=udp",
        "turn:relay.example.com:3478?transport=tcp",
        "turns:relay.example.com:443?transport=tcp"
      ],
      "username": "user",
      "credential": "password"
    }
  ]
}
```

- TURN input augments configured STUN defaults. Validate schemes, ports, length, and structure; show a sanitized preview. Keep temporary credentials and the shared access code in browser memory only, never in URLs, database records, exports, or browser persistent storage. Refresh short-lived Xirsys credentials immediately before Xirsys-backed relay probes so peer wait time cannot leave stale credentials. Each device configures its own credentials.
- Preflight can run without a second device. Probe each STUN endpoint and each configured TURN URL independently with a disposable peer connection, bounded timer, and cleanup. Report candidate gathering/allocation independently from actual peer connectivity.
- The default connection policy and automatic matrix are defined below. Individual TURN probes isolate each URL. Tests requiring a relay on both devices require both devices to configure TURN; one-sided relay tests are distinct and use only the required side's credentials.
- Display direct UDP, observed ICE-TCP, TURN UDP/TCP/TLS evidence separately. Candidate `protocol` and TURN `relayProtocol` represent different hops. Preserve raw supported fields; label unavailable fields rather than guessing.
- Each device verifies its requested TURN transport using its own selected local relay candidate's `relayProtocol`: `udp`, `tcp`, or `tls`. Remote relay transport stats may be unavailable; verify that transport through the other device's local verdict, not a required remote `relayProtocol` field. Both devices must still confirm the requested candidate types, application ping, and their local transport evidence before a paired pass. Missing or mismatched local evidence remains inconclusive; plain `tcp` does not prove TLS.
- Managed credential refresh may return a different relay host. Preserve the canonical requested alternative slot's transport and port, but use credentials only with their returned endpoint. Prefer an exact returned URL; permit only an unambiguous compatible host replacement. Log requested versus actual endpoints and retain each device's actual endpoint in shared result evidence. Incompatible refresh results must fail explicitly, not borrow credentials for an unreturned URL or silently change transport/port. Distinguish credential HTTP/timeout failures, endpoint alignment errors, and RTC setup errors without raw provider payloads or secrets.

## Required diagnostics and bounded capability checks

Page load initializes a local run and automatically starts browser/API/secure-context, signaling reachability, local candidate gathering, and all configured STUN/TURN endpoint checks on EACH device, including visitors opening a join link. No Run diagnostics click is required and no throughput traffic runs on page load. Users may choose create/join intent while checks run, but actual room operations wait for completed current preflight and valid required configuration/browser support; an invitation preselects join intent but still requires explicit user action to occupy a room slot. Prerequisite means completed, not every network test passed: failed/timed-out network checks are valuable evidence and do not bar an otherwise possible connection. Missing WebRTC support or invalid required configuration blocks continuation; an unavailable signaling service explains why room actions cannot succeed. Cancelled/incomplete or stale preflight does not unlock room actions. Applying ICE configuration or observing a supported network change invalidates preflight and automatically checks the current configuration; offer Recheck device inside diagnostics for undetectable changes. Draft settings do not mutate the active configuration on every keystroke. Explain and confirm disruptive active-session rechecks/configuration retries instead of silently tearing down a working room.

Device-only checks distinguish local gathering, endpoint discovery/allocation, and actual paired connectivity. Host candidates alone do not prove STUN success; require mapped-address evidence from the isolated endpoint probe. Once the required host, srflx, or relay candidate evidence appears, the isolated probe succeeds without waiting for a browser-specific gathering-complete event; missing evidence still waits until completion or deadline. TURN probes retain each endpoint's credentials in browser memory, require relay-allocation evidence, and never equate allocation with peer connectivity. Missing TURN is not configured, not a failure. Browser limitations and missing evidence are unsupported/inconclusive, never general claims that UDP/TCP is allowed or blocked. Preserve cancellation, deadlines, bounded concurrency, and configuration/check generations so obsolete results cannot unlock room actions.

The browser capability summary explicitly distinguishes TURN relay-only
isolation, which standard `iceTransportPolicy: "relay"` can request, from
direct ICE-TCP isolation, which browser JavaScript cannot request because the
standard policy exposes only all-candidate or relay-only modes. A browser may
support or expose TCP candidates internally without making a direct TCP-only
matrix row enforceable. Report that distinction before users inspect matrix
outcomes.

Once both peers join and are ready, automatically schedule five capability categories without an additional button: Direct, STUN-assisted, TURN UDP, TURN TLS, and TURN TCP. A successful connection MUST NOT cancel the other categories. Distinguish Main connection ready from Diagnostics complete, and show completed/total/running/queued category counts.

STUN is a discovery mechanism, not a separate media/data transport. Separate endpoint discovery/allocation checks from the paired categories. For STUN-assisted tests isolate the requested endpoint and report the actual selected host/srflx/prflx pair. If a host path wins, that does not establish that a srflx path worked. Candidate-constrained testing must be verified; inability to isolate a path is inconclusive/unsupported, never success under another label. Direct ICE-TCP isolation remains an unsupported device capability explanation, not additional paired rows.

Display the existing `stun-assisted` category as **STUN mapped-address connectivity**.
Explain that local host candidates are withheld from signaling in this check,
unlike normal ICE with local fallback. Preserve the existing category ID,
candidate filtering, budgets and pass criteria. Timeout details must distinguish
local address discovery, offer/answer exchange, remote candidate availability,
ICE connectivity, channel opening and the application handshake, using evidence
from the current probe rather than assuming an earlier preflight still applies.
Successful discovery followed by stalled mapped-address ICE must say so in the
event log, shared results and exports. Preserve pre-close ICE state on deadlines;
do not infer NAT hairpinning, firewall policy or a STUN outage from a timeout.

Build the five-category manifest from BOTH devices' sanitized endpoint capabilities without sharing TURN secrets. Within a category, pair endpoint variants in deterministic order, never a Cartesian product. Try the primary pair first, using another port/endpoint only if no verified pass was obtained and the shared category budget permits. Match transport categories when both devices configure TURN; when only one does, test that side's relay against the other side's STUN-assisted or direct configuration. Missing configuration is an explicit not-configured category. Mixed-transport and exhaustive one-sided/two-sided combinations are no longer part of the automatic scope. Details and exports identify each requested endpoint on A and B, actual selected-pair evidence, queued/active/terminal status and timing, and alternatives not tried. No claim that every possible endpoint, interface, candidate pair, or NAT route was tested.

Each category reports whether it worked. If Direct also passed, describe a later success as an alternative path verified, not increased connectivity. Only describe added connectivity in this run when the direct baseline explicitly failed; unsupported, inconclusive, and timed-out baselines do not establish a general connectivity improvement.

Both peers must acknowledge the same server-issued category manifest before any paired probe starts. Each attempted pair uses an isolated peer connection on each device and a canonical attempt/pair/probe identity. Terminal results are shared through authorized, bounded Worker/D1 coordination so asymmetric outcomes cannot make peers independently retain a pass versus try a fallback. Late/duplicate messages cannot overwrite committed terminal evidence or resurrect cancelled work. Per-probe HTTP polling stays serialized. Signaling failures must surface as signaling failures, not credential failures or generic data-channel timeouts. Allocation, ICE checks, channel opening, and bidirectional application pings remain separate evidence; only both devices' verified selected-path results establish a paired pass.

Probe message handlers must be installed before channel readiness can trigger
traffic, including an already-open incoming channel. Open notifications are
idempotent. The bounded handshake must tolerate an early challenge arriving
before the peer is ready without accepting unrelated or stale pong/verdict
messages. Require each side's own verified round trip plus selected-path and
peer confirmation, not merely ICE connected. Cancellation, channel closure and
the enclosing probe deadline terminate waits and remove listeners/timers.

Room coordination publishes unchanged capabilities once per participant and
configuration generation rather than on every status check. While waiting for
the peer or shared acknowledgement, status polling backs off from 500 ms to a
five-second ceiling. The active matrix owns coordination until it settles;
afterward, sparse 15-second checks exist only to discover coordinated retries.
Coordination polling pauses while the page is hidden and resumes immediately
when visible; probe signaling retains its own bounded active polling cadence.

Launch at most three capability categories concurrently, with at most one active endpoint alternative per category. Show queue time separately from execution duration. Retain only a bounded set of policy candidates for the main channel, closing losers and cancelled probes promptly. Continue the remaining categories independently of main-channel availability. A category has a total 30-second active budget shared across alternatives, credential refresh, and result synchronization; a first endpoint timeout must not consume the entire fallback budget by design.

Accepted application preference: Direct, STUN-assisted, TURN UDP, TURN TLS, then TURN TCP. This is application policy, not a universal performance claim. Main messaging becomes available as soon as a shared verified result cannot be displaced by a higher-priority category. Remaining diagnostics continue. Retain the actual verified channel rather than rebuilding and assuming the path is unchanged.

Connectivity probes run concurrently, but bandwidth measurements do not. After all five categories settle, run the existing bounded RTT/goodput test only if the selected path does not use TURN. Relay paths never run speed traffic. Endpoint alternatives not needed for a verified category pass remain visibly not tried. Failure or cancellation preserves other completed evidence and the partial report.

## One report with correlated test tracks

Present ONE report per shared attempt, with nested device/preflight, room/signaling, connectivity-profile, main-session, performance, and upload tracks. The UI offers a merged timeline, per-test filters, an expandable matrix, and a timing waterfall. Copy/export defaults to the complete LOCAL report, not only a selected filter. Owners retrieve a merged report of both devices from D1; participants cannot retrieve the other device's persisted report. Reports clearly list missing/pending remote records. A participant screenshot and the owner report share the same attempt ID after pairing; pre-pair run IDs remain linked/searchable.

Add `probeId`, `peerConnectionId`, `spanId`, `parentSpanId`, configuration-version identifier, and per-device sequence numbers to the event model. Never put credentials or reversible credential hashes into configuration identifiers. Server-owned test manifests and scoped participant credentials constrain valid probe identities. Each message includes attempt generation and probe identity so ICE/SDP from concurrent tests cannot cross-contaminate another connection. Rerunning a profile creates a new probe ID with a link to the previous result.

Timers include queued time, active duration, gathering, signaling, connectivity checks, data-channel setup, ping round-trip, throughput, main-selection wait, total suite wall time, and report-upload completion. Report overlapping spans as overlapping; do not sum parallel test durations as wall-clock total. Use monotonic local clocks for durations, server receipt timestamps and message correlation for causal ordering across devices, and explicitly approximate merged cross-device display ordering. Do not calculate one-way network latency from unsynchronized clocks. Timeouts mean this profile did not complete within the recorded deadline, not permanent transport impossibility.

Keep summary/milestone/failure records for EVERY scheduled test in a reserved bounded summary budget; sample repetitive poll/stats details first. If raw-detail limits are reached, explicitly mark dropped counts and time windows. No summary may disappear silently. Persist partial reports continuously, including preflight failures, instead of waiting for the whole matrix. DB events are structured rows backing one logical report, not separate user-facing log files.

## Product surfaces

1. A guided primary room surface: explicit create/join intent, automatic-check progress, code/link with copy invitation, an optional provider-neutral TURN relay access-code field, two participant slots, plain-language connection status, connected text messaging, and context-appropriate leave/retry actions. Invitation visits focus on joining that room. Keep technical IDs and transport detail out of the primary flow.
2. A diagnostics drawer, closed by default: wider non-modal desktop side panel (up to 56rem, 60vw) and accessible modal full-screen mobile sheet. It contains automatic device/preflight summaries and per-check outcome/duration, Recheck device, advanced ICE configuration with explicit Apply, and visible/copyable attempt or local run identity.
3. Within diagnostics: five capability cards in Summary view and a Pair details view showing configured A/B endpoints, tried/not-tried states, status, timing, and actual selected-pair evidence. Switching views does not start new tests. Preserve event timeline, selected path, and stage timers. A concise main-surface indicator distinguishes usable connection status from ongoing diagnostic progress.
4. Performance probe controls/results in diagnostics; show the automatic bandwidth preference and planned traffic budget before connecting, and honor either participant's opt-out. Keep connected text messaging primary while additional checks continue.
5. Copy complete local text report, download JSON, and a compact screenshot-friendly summary containing actual results, identity, coverage and upload status. All views/exports share consistent report data regardless of drawer/filter state. Export remains usable after failure.
6. Owner review page: Sign in with ChatGPT, list/filter attempts by ID/date/outcome, inspect both devices' events, and download reports.

Responsive, keyboard-operable controls and screen-reader status updates are required. Drawer focus/close behavior must work with keyboard and viewport changes; normal progress must not steal focus or automatically open diagnostics. Auto-scrolling logs must not interrupt someone reviewing older entries. Transport details belong in the diagnostic view; core room controls stay simple. Participant pages must not contain owner/deployment implementation-note cards. See UX_REDESIGN_PLAN.md for the approved layout direction, implementation sequence, and acceptance checklist.

## State, timers, and diagnostics

Use an explicit session state machine: idle, preflight, creating/joining, waiting-for-peer, signaling, checking, connected, disconnected, failed, closed. ICE gathering, signaling, data-channel, and probe states are separate because they overlap. Retries/reconnections have new attempt generations; no stale candidate may enter a new generation.

Every application operation emits start/end/outcome, elapsed milliseconds from a monotonic clock, and a wall-clock timestamp for correlation. Record HTTP latency/status, poll delays/retries, offer/answer creation and application, candidate send/receive/application, ICE transitions, data-channel open/close/error, stats collection, probe phases, and log-upload state. Show waiting duration distinctly from active network negotiation. Never subtract timestamps across devices as a latency measurement.

Candidate details: local/remote, host/srflx/prflx/relay, IP address or mDNS name and port, protocol, TCP type, address family, related address where exposed, source server, discovery time, and selected-pair association. Paired-probe events distinguish gathering, filtering/signaling, remote receipt/application, ICE transitions, and observed candidate-pair states with nominated/selected evidence. Sample and deduplicate actual browser pair stats, never manufacture all candidate combinations. Bound per-probe detail volume with an explicit truncation notice, stop sampling at terminal/cancellation, and retain last observed states for timeout investigations. Include explicit attempt/probe/device correlation and monotonic elapsed timing. Allow users to reveal earlier retained events rather than making everything before the latest 50 inaccessible. Peer-reflexive candidates may appear only in stats. Account for mDNS address hiding and browser field omissions; never resolve or guess an IP hidden by the browser.

Inspect candidate pairs and transport/DTLS/SCTP state where exposed. Capture stats at major transitions and at a bounded live sampling interval (default one second during active measurement, five seconds otherwise). Missing values are unavailable, never zero. Bound history and sampling volume.

Diagnosis records contain evidence, severity, stage, and confidence: observed, suspected, unknown, or not tested. Cover invalid configuration, missing API, failed signaling, full/expired rooms, no peer answer, gathering timeout, server errors, no viable pair, negotiation errors, channel failure, network changes, and probe interruption. Preserve browser error codes and sanitized text. A STUN timeout/701 alone does not establish UDP blocking; gathering a candidate does not establish reachability. DNS, firewall, certificate, and authentication explanations are only asserted when evidence supports them; otherwise list possibilities.

NAT: report observed mapping/connectivity behavior and its limits. Do not claim reliable full-cone/restricted/symmetric classification from ordinary browser candidate gathering. Formal RFC 5780 behavior testing is outside the initial version. HTTPS reachability is not proof of TURN TCP/TLS availability.

Initial limits: 10-second HTTP requests (shortened when a category has less time left), 15-second per-server preflight probes, 30-second total budget per active capability category shared among fallbacks, and rooms expiring after 15 minutes of inactivity. These are application deadlines, not declarations of network impossibility. Record browser tab visibility and timer throttling where observed.

## Performance measurement

Automatically run a bounded performance probe on the main channel after the connectivity matrix finishes unless either side of the selected profile uses TURN; relay paths never run performance traffic. Show the planned traffic budget before connecting, permit disabling automatic bandwidth testing, and provide cancel/rerun controls for eligible direct/STUN paths. The host coordinates phases so peers do not launch competing probes.

- Idle RTT: 20 application ping/pong samples at 100 ms spacing, with sender-local monotonic timestamps and bounded response deadlines. Show minimum, median, p95, maximum, sample count, and unanswered pings. Keep ongoing low-frequency RTT monitoring separately.
- ICE RTT: display `currentRoundTripTime` when available with its own label; it is a STUN connectivity/consent measurement, not application RTT.
- Throughput: sequential A-to-B and B-to-A tests use a configurable test length, defaulting to 3 seconds and configurable from 1–10 seconds. Each direction sends at least 8 MiB when the path and deadline permit, then continues for the configured length. A configurable per-direction safety ceiling defaults to 100 MiB (8–256 MiB); total payload is at most twice that ceiling plus protocol overhead. The execution deadline is at least 5 seconds and grows to the configured test length. A byte ceiling remains authoritative, so a fast path that reaches it early is explicitly reported as cap-limited rather than as a stable full-duration estimate. Show the receiver-measured transfer duration with every directional result. Report if a cap, cancellation, visibility change, timeout, or connection change truncated measurement.
- Use a dedicated reliable ordered data channel and bounded binary chunks (at most 16 KiB and within negotiated message size), `bufferedAmount` backpressure, and cancellation. Receiver-measured bytes over receiver-local elapsed time determine delivered application goodput, not bytes merely queued by the sender. Specify warm-up/drain/measurement boundaries in protocol tests.
- Show each direction in Mbps, bytes received, measured duration, buffering, and RTT under load. Record channel settings and selected pair before/after; a changed path invalidates a stable-path summary.
- Label results short data-channel goodput, not ISP bandwidth or a guaranteed maximum. Browser `availableOutgoingBitrate` is an optional RTP estimate and must not substitute for data-channel measurement. Do not infer packet loss from reliable-channel ping timeouts or unavailable media stats.

## Attempt identity and persistent reports

D1 holds rooms, participant slots/token hashes, bounded signaling envelopes, connection attempts, diagnostic runs/events, and performance summaries. SQL schema uses versioned migrations and prepared queries.

- Generate a local `runId` before the first network operation so preflight/registration failures can be exported. Register it idempotently when the API is reachable.
- The server creates a shared `attemptId` for each paired connection generation; both devices receive it via signaling. Every persisted event has the shared attempt ID when known, local run ID, participant ID, probe/span identity when applicable, sequence, event type/version, client time/elapsed time, and server receipt time.
- The visible/copyable attempt ID in diagnostics and reports exactly matches the DB identifier. Before pairing, clearly display the local run ID there instead; retain that association after pairing. Do not silently replace an offline identifier without recording the mapping.
- A retry or ICE restart gets a new shared attempt ID linked to its predecessor. Preflight-only, failed joins, and orphaned runs remain searchable under their run IDs.
- Log upload is append-only, schema-validated, bounded, batched, retried with backoff, and idempotent by run/sequence. Server derives identity from scoped write credentials, never trusts a submitted room/participant binding. Unknown event fields are rejected or stripped.
- Preserve all attempt summaries subject to a proposed 30-day retention default. Bound detailed events in each run to 2 MiB/5,000 events; reserve separate bounded manifest/summary storage for each scheduled profile, summarize repetitive polls/stats and explicitly record truncation. Bound configuration input to at most three STUN and six TURN URLs per device and deduplicate them, so matrix summaries remain bounded; reject larger inputs clearly rather than silently dropping paths. Apply endpoint quotas/rate limits and cleanup expired rows in bounded batches. Retention enforcement must work without assuming unsupported scheduled Workers features.
- Flush periodically and best-effort on page exit; retries must not interfere with WebRTC. Clearly show saved/pending/upload-failed/truncated status. A browser crash, offline network, or abrupt close can prevent upload: never promise every event is stored. Copy/download still works from the local buffer while the page remains open.

## Owner-only access and privacy

Use Sites Sign in with ChatGPT for `/admin` and server-side identity checks on EVERY diagnostic read/export endpoint. Successful sign-in alone is insufficient: compare the platform's stable site-specific user ID against an explicitly provisioned owner ID in hosted configuration. Fail closed when unset. Never use first visitor/first login as owner, client-supplied identity, a room code, or email alone as authorization. Resolve and verify the owner's platform identity during deployment setup.

Participants can read room signaling as needed and export their own in-memory report; they cannot retrieve stored reports, enumerate attempts, or read another participant's history. Attempt IDs are references, not read credentials. Scope and hash participant write/poll tokens; enforce origin/CSRF defenses as applicable. Public room access and private admin routes are distinct from the Site-wide access policy.

Sanitize diagnostic data before upload and again server-side. Exclude TURN credentials, access tokens, ICE passwords/ufrags, raw SDP, raw candidate strings, chat message bodies, and probe payloads. Persist allowlisted candidate fields and normalized error categories. User-approved scope update (2026-09-10): actual candidate IP addresses, mDNS names, and ports are included in the local event log, copied/downloaded reports, and server-saved owner-only diagnostics instead of address aliases. Explain this in the event-log UI so users can review addresses before sharing. This approval does not include credentials, room codes, or arbitrary raw browser/error payloads. Raw SDP/candidates needed for signaling are a separate ephemeral, participant-authorized data path and expire promptly. Logs display untrusted text safely.

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

Browser tests additionally verify automatically started, mandatory completed preflight on both devices and join links; explicit room intent cannot bypass current prerequisites or submit twice; failed network probes do not block otherwise viable joining; applied configuration changes invalidate results and start fresh checks; cancellation/stale results cannot unlock room actions; all five categories settle even after an early winner; concurrent signals stay isolated; category timeouts exclude queue time; higher-priority success beats earlier lower-priority success; no throughput overlaps category checks or overrides either peer's opt-out; summaries survive raw-log truncation; copied reports include the full local run, tried/untried pair details, and stable correlation IDs. Verify Summary/Pair details switching does not issue new probes and the wider panel remains usable on desktop and mobile.

Browser tests: two isolated contexts using actual WebRTC connect and exchange data, automatic preflight views, a diagnostics drawer closed by default, state/timer visibility, invitation copy/join, report copy/download and matching IDs, interrupted signaling/retries, peer leave/restart, safe recheck/configuration application, performance cancel/completion/bounds, mobile layout, drawer keyboard/focus behavior, and screenshot-friendly reports containing actual results. Test bounded real throughput without requiring minimum internet speed; use deterministic fixtures for exact calculations. Browser testing is explicitly in scope.

Controlled network acceptance: actual different-device/different-network connection; TURN UDP, TCP, and TLS paths independently verified using supplied test credentials; relay-only path confirmed in stats; invalid TURN credentials, unreachable server, and UDP-blocked/TLS-success case where an appropriate network environment is available. Local two-tab tests do not prove NAT traversal. Mark any unavailable transport test unverified, never passed. No TURN service is provisioned by default.

Release acceptance: demo works; all three diagnostic phases are usable; performance results are accurately labeled; both clients and stored reports share IDs; unauthorized retrieval is denied; secrets never enter reports; checks pass; remaining external-network limitations are documented.

## Implementation sequence and delegation

Model routing and efficient-execution policy are maintained in AGENTS.md. Copilot performs the local build with Sol orchestrating, Terra doing most implementation, Luna handling narrow tasks, and Astra reserved for justified difficult escalations; the user confirms all four models are available. When work returns to Codex, Terra orchestrates by default, Luna handles narrow tasks, Sol handles targeted escalations/reviews, and Astra is reserved for justified exceptional escalations. There are no user-imposed session/token budgets or allowance checkpoints. Complete the full scope and validation while avoiding unnecessary model expense and duplicated work. Purchases, billing changes, reset redemption, and paid external-service provisioning still require user authorization. KICKOFF.md contains separate Copilot build and Codex hosting prompts; BUILD_HANDOFF.md defines the boundary and required handoff evidence. These agent-usage changes do not alter application safety limits such as probe traffic caps, timeouts, log bounds, and retention.

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
