# Status - room-first UX redesign implemented

## Current milestone - Codex Sites deployment candidate, 2026-09-08

- Normalized incidental surrounding whitespace on the hosted diagnostic access
  code and authorized browser submission. An incorrect code now returns a
  relay-specific message after room authorization instead of the ambiguous
  `forbidden`; room and participant authorization failures remain generic.
- Moved the optional TURN relay access code from advanced diagnostics onto the
  primary room surface. Participant-facing copy is provider-neutral and omits
  password-policy details. In-room relay activation/removal now has its own
  Apply action, draft-versus-active status, accessible live feedback, and
  stale-response invalidation so leaving cannot restore credentials.
- Delegation: at the user's request, GPT-6 Astra medium reviewed the relay-code
  UI. It identified stale credential responses after Leave, confusing
  empty/no-op application states, and inaccessible success feedback; all three
  findings were corrected and covered before publication.
- Removed the room-lifetime 500 ms coordination loop exposed by hosted
  analytics. Each participant now publishes unchanged capabilities once per
  configuration generation; waiting status checks back off from 500 ms to five
  seconds, settled rooms check for retries every 15 seconds, and hidden tabs
  stop coordination polling. For a settled two-device room this reduces the
  two affected endpoints from about 240 requests/minute to about 8, while the
  browser test verifies capabilities are not reposted and status does not
  resume a tight loop after diagnostics complete.
- Physical two-iPhone Safari validation passed after deployment of the serialized
  polling fix. The supplied hosted report selected direct host/UDP, verified
  bidirectional application traffic, passed five paired STUN-assisted rows with
  srflx evidence, answered 20/20 RTT probes, and measured both goodput
  directions. The live hosted asset matched the local fixed bundle.
- The same report exposed an evidence/reporting issue: one isolated STUN check
  timed out after already gathering srflx evidence, while its paired rows later
  passed. Endpoint preflight now succeeds as soon as the required host, srflx,
  or relay candidate appears instead of depending on Safari to emit a
  gathering-complete event.
- Device checks, connection-path rows, event messages, compact failures, and
  exported matrix results now name the credential-free STUN/TURN server address
  rather than exposing only an indexed transport ID. This makes a failed result
  attributable to Cloudflare or a specific custom endpoint.
- Cloudflare `stun.cloudflare.com:3478` is the sole built-in STUN server; users
  can still add or replace endpoints through advanced configuration.
- Selected TURN relay paths now skip RTT/goodput speed checks entirely. They
  still verify selected-pair evidence, bidirectional application traffic, and
  chat without spending a capped relay allowance on throughput measurement.
- Added optional managed Xirsys TURN issuance. The Worker requires both scoped
  room-participant authorization and a shared diagnostic access code, keeps
  long-term Xirsys values server-side, validates the upstream response, and
  returns only temporary TURN credentials. The client retains the access code
  and credentials only in tab memory and refreshes credentials immediately
  before each Xirsys-backed relay probe.
- Expired rooms cannot issue credentials even while an old participant record
  awaits cleanup. Draft access-code edits cannot alter an active relay session,
  and aggregate default, managed, and custom ICE limits are validated before
  state changes rather than during rendering.
- The managed relay access-code minimum is six characters across the browser,
  Worker validation, tests, and deployment guidance. Deployment guidance still
  requires a randomly generated code because this shorter shared secret has
  less brute-force resistance.
- Diagnosed a real two-iPhone Safari failure from paired reports: both devices
  passed HTTPS, WebRTC API, signaling reachability, host gathering, and STUN
  gathering, but every paired row ended at the 30-second data-channel deadline.
  Per-probe polling could overlap and complete out of order on slower mobile
  responses, regress its cursor, and replay signaling. A poll/candidate failure
  also closed RTC without rejecting the open wait, masking the cause as a later
  timeout.
- Serialized each probe's signaling polls and now reject the active open wait
  immediately with the actual signaling failure. Added deterministic
  non-overlap coverage. The full Chromium suite still passes, and a focused
  two-context Playwright WebKit run connected and exchanged application data in
  33.2 seconds. Actual iPhone confirmation remains pending redeployment.
- Prepared the completed UX branch for Codex Sites without deploying or
  provisioning from Copilot. `KICKOFF.md` now contains the current Terra-medium
  deployment prompt, and `HANDOFF.md` contains the ordered platform checklist.
- Cleaned the production server output so `dist/server/` contains only the
  bundled Worker entrypoint. The staged candidate is 544 KiB and contains
  `dist/server/index.js`, `dist/client/index.html` plus hashed assets, and exact
  copies of both ordered D1 migrations under `dist/.openai/drizzle/`.
- `npm run check` passed formatting, strict TypeScript, ESLint, 45
  unit/integration tests in 7 files, and both production builds.
- `npm run test:browser` passed all 5 enabled Chromium tests, including managed
  TURN access-code privacy and real two-context WebRTC; the opt-in WebKit
  device test remained skipped by its existing environment gate.
- Delegation: Terra medium implemented the bounded Worker/API foundation. The
  root integrated the client lifecycle and tests. A final Sol-medium review
  found expired-room issuance, aggregate ICE validation, and draft/applied
  access-code lifecycle risks; all three were corrected before validation.
- Artifact inspection confirmed one server bundle, no external ESM imports,
  both expected client assets, and byte-identical staged migrations.
- No known local implementation defects remain. Codex owns the existing Sites
  project inspection, intended-audience confirmation, production `DB` binding,
  `ENVIRONMENT`/secret owner configuration, migration application, deployment,
  and hosted identity/D1/two-device verification. TURN and external-network
  validation still require suitable credentials and environments.

## UX implementation milestone - 2026-09-07

- Implemented the approved room-first participant flow through source commit
  `0db97ba`: automatic generation-safe device checks, explicit pending room
  intent, invitation-first joining, waiting/connected/recovery states, primary
  messaging, copy invitation, and coordinated participant-initiated retries.
- Added a diagnostics drawer closed by default: non-modal desktop panel,
  focus-contained/inert mobile sheet, responsive viewport changes, explicit
  configuration Apply, device recheck, performance preference, complete local
  report actions, and a real compact summary.
- Incorporated Safari review feedback: the advanced-settings summary now
  identifies the default STUN discovery server, the optional JSON field has
  a valid greyed example plus a plain-language STUN/TURN explanation,
  "automatic bandwidth" is now described as a bounded connection speed check,
  and its stop control appears only while test traffic is active.
- Corrected device evidence: separate browser/signaling/local/STUN/TURN tracks,
  srflx-only STUN success, relay-only TURN allocation, full in-memory
  `RTCIceServer` credentials at the RTC boundary, distinct candidate/stats
  normalization, bounded concurrency/deadlines/cancellation, and stale
  generation protection.
- Follow-up paired-path evidence now filters signaled candidates to the
  requested host/STUN/TURN class. In the local Chromium run, six STUN-assisted
  rows passed with selected `srflx`/`prflx` evidence; two one-sided rows remained
  honestly inconclusive because the browser selected its own local host
  candidate, which standard WebRTC cannot exclude. Guest reports now receive
  the host-measured RTT summary instead of displaying a misleading `0/20`.
- Device diagnostics now report browser transport capability directly:
  TURN relay-only isolation is feature-tested through the standard relay
  policy, while direct ICE-TCP isolation is marked unsupported with the
  all-candidate versus relay-only API limitation explained.
- Expired or stale room authorization now returns a distinct forbidden response
  instead of the misleading `invalid capabilities` error. The participant
  client tears down the dead attempt and restores actionable create/join
  controls without clearing the local database.
- Added participant-facing upper-bound countdowns derived from the actual
  15-second device-probe and 30-second active-path deadlines. The main room now
  shows speed-check phases, its remaining upper bound, and completed
  per-direction results. Participant markers use explicit semantic state, so
  both devices are green after connection instead of coloring only the current
  device.
- Reworked the speed check into an adaptive measurement: a configurable 1–10
  second test length defaults to 3 seconds, while a configurable 8–256 MiB safety
  ceiling defaults to 100 MiB per direction. The byte ceiling remains
  authoritative, short fast-link measurements are labeled cap-limited, and
  every directional result shows its receiver-measured transfer time. Either
  participant can restart the check; the initiator's selected limits are
  synchronized before both peers rerun it.
- The local development server now honors explicit `--host` and `--port`
  options. LAN UI review can use `npm run dev -- --host 0.0.0.0 --port 4173`;
  real mobile WebRTC diagnostics still require a browser-trusted HTTPS origin.
- Fixed blank startup on insecure LAN origins where Chrome omits
  `crypto.randomUUID()`. Client IDs now use `crypto.getRandomValues()` as the
  cryptographically strong browser-compatible fallback. The LAN URL renders
  without client errors; its insecure-context limitation remains explicit.
- Corrected mobile capability reporting so browser WebRTC API support and the
  page's secure-context status are separate rows. Android Chrome now reports
  WebRTC support accurately while plain LAN HTTP reports the actual blocker:
  the checks require a trusted HTTPS origin.
- Preserved the full paired connectivity matrix and Workers/D1/Sites/auth
  boundaries. Either participant can request one idempotent shared retry.
  Automatic bandwidth traffic begins only after the matrix and is skipped when
  either peer opts out.
- `npm run check` passed: formatting, strict TypeScript, ESLint, 37
  unit/integration tests in 7 files, client build, and Worker build.
- `npm run test:browser` passed in Chromium: 4 tests in 2.0 minutes. It covered
  automatic invitation checks and pending-intent withdrawal, 390px modal and
  1440px non-modal drawer behavior with no horizontal overflow, actual
  Worker-signaled two-context WebRTC, 9/9 terminal matrix rows, bidirectional
  chat, synchronized report IDs/content, bounded performance, compact report,
  connected peer markers, synchronized configurable speed-check restart,
  expired-room recovery, and a guest-originated retry observed by both peers.
- Screenshots are retained outside Git at
  `/Users/renjay/.copilot/session-state/7dc1b6c4-cd09-4eb1-8e6f-0f8009517c38/files/ux-redesign-evidence/`.
  They cover mobile invitation/checking, drawer and validation failure plus
  desktop waiting, connected, drawer, and compact-report states.
- Root/orchestration and integration review: GPT-5.6 Sol, medium. Terra medium A
  implemented the check engine; Terra medium B implemented presentation;
  Terra medium implemented bounded `main.tsx` integration. Sol integrated,
  corrected retry/performance/report lifecycle issues, and ran final evidence.
  Astra was not used; no blocker justified escalation.
- Remaining verification gaps require supplied TURN credentials or external
  network/device conditions: relay UDP/TCP/TLS allocation/connectivity, NAT
  traversal, and real cross-network behavior. Local checks do not prove hosted
  owner identity or D1 deployment behavior. No deployment or hosted
  configuration change was made.

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
