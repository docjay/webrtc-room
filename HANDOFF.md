# Copilot build handoff

## Current handoff - Codex Sites deployment candidate, 2026-09-08

- **Xirsys response-shape fix pending deployment:** live provider
  authentication succeeded and returned a successful `v.iceServers` as one
  RTCIceServer object containing one STUN and six TURN URLs, rather than the
  legacy array assumed by the Worker. The parser now validates and accepts
  both documented shapes, filters STUN, emits six isolated bounded TURN
  entries, and fail-closes on malformed objects or `s: "error"` envelopes
  without exposing provider payloads. This evidence includes no credential or
  account identifier. The compiled corrected adapter also succeeded against
  the real provider, producing six isolated entries (two UDP, two TCP, two TLS).
  Real two-device TURN allocation/connectivity remains pending.
- **Branch:** `main`
- **Implementation source commit:** `0342a1624177dadb04486ed0fb73dd4cdd97f633`
- **Starting/planning commit:** `1c62490`
- **Worktree:**
  `/Users/renjay/code/worktrees/webrtc-room/ux-redesign-plan`
- The room-first participant redesign is implemented locally. Diagnostics are
  closed by default, checks start automatically, invitation intent remains
  explicit, messaging becomes primary when a verified channel opens, and
  technical evidence remains available through an accessible responsive
  drawer and complete local report.
- **Resolved iOS signaling incident:** two same-Wi-Fi iPhone Safari reports exposed
  overlapping per-probe signaling polls. Slower out-of-order responses could
  regress the cursor and replay negotiation messages, while failure was masked
  as a 30-second data-channel timeout. Polls are now serialized and signaling
  failures reject the open wait immediately. That fix was deployed before the
  successful physical iOS result below.
- **Physical iOS result:** after that redeployment, a supplied two-iPhone Safari
  run connected over direct host/UDP, verified bidirectional application
  traffic, passed five paired STUN rows with srflx evidence, completed 20/20 RTT
  probes, and measured goodput in both directions. The hosted asset matched the
  serialized-polling build.
- **New accuracy fix pending deployment:** Safari gathered srflx evidence for
  one isolated STUN probe but did not emit gathering-complete before its
  deadline, producing a false timeout even though paired rows passed. Isolated
  probes now succeed immediately when their required host/srflx/relay evidence
  appears.
- **Endpoint labels pending deployment:** device checks, matrix rows, event
  messages, compact failures, and exported matrix results identify each
  credential-free STUN/TURN server address. Credentials remain excluded.
- **Default endpoint change pending deployment:** Cloudflare
  `stun.cloudflare.com:3478` is the sole built-in STUN endpoint; custom
  STUN/TURN configuration remains available.
- **TURN quota protection pending deployment:** selected TURN relay paths skip
  RTT/goodput speed checks entirely while retaining connectivity verification,
  bidirectional application pings, and chat.
- **Xirsys integration pending deployment/configuration:** an authorized room
  participant can exchange the shared diagnostic access code for temporary
  Xirsys credentials through the Worker. Long-term Xirsys values never reach
  the browser, D1, reports, logs, URLs, or Git. The client refreshes temporary
  credentials immediately before each Xirsys-backed relay probe.
- **Relay access UX pending deployment:** the participant-facing field is now
  provider-neutral and visible on the primary room surface before and during a
  room. It omits minimum-length messaging, exposes a dedicated Apply/Disable
  action after authorization, announces status accessibly, and invalidates
  delayed credential responses when room access ends.
- **Relay mismatch feedback pending deployment:** surrounding whitespace is
  normalized on the configured and submitted diagnostic code. Authorized
  incorrect-code requests receive a specific relay error, while room
  authorization failures remain generic.
- **Xirsys request correction pending deployment:** credential issuance now
  follows the provider-supplied Node example: `PUT /_turn/{channel-path}` with
  server-only Basic `ident:secret` authentication and
  `{"format":"urls"}`. Channel path segments remain path segments, and rejected
  API credentials/channel receive a distinct sanitized message.
- **Coordination traffic fix pending deployment:** unchanged capabilities are
  published once per participant/configuration generation instead of every
  500 ms. Waiting room-status checks use bounded exponential backoff, settled
  rooms check every 15 seconds only for retries, and hidden tabs do not poll.
  This removes the analytics spike from the room-lifetime tight loop.
- Safari review terminology is incorporated: advanced settings identify the
  sole Cloudflare STUN discovery server, show an optional valid STUN/TURN JSON
  example and explain both server roles, while the bandwidth preference is
  presented as a bounded connection speed check. The stop action is visible
  only while that traffic is running.
- `src/client/device-checks.ts` owns browser/signaling/local/endpoint check
  generations. `webrtc.ts` retains full credentials only at the browser RTC
  boundary. `components/` owns presentation-only room, drawer and compact
  report surfaces. `main.tsx` owns room intent, matrix/performance integration,
  report/upload coordination and recovery. The existing Worker/D1/admin seams
  remain intact.
- Either room participant may request a retry using the current scoped room
  credential. Repository issuance coalesces concurrent retry requests sharing
  the same predecessor into one canonical generation; unrelated stale
  predecessors still fail.
- Automatic performance preference is synchronized over the selected ordered
  channel. Either peer's opt-out prevents RTT/goodput traffic. The adaptive
  test length defaults to 3 seconds and 100 MiB per direction; both limits
  are configurable in Diagnostics, remain bounded, and synchronize when either
  participant restarts the check. The host's RTT samples are synchronized to
  the guest report so both views describe the same measurement.
- Device and matrix progress show deadline-derived upper-bound countdowns, and
  the main room shows the active speed-check phase, countdown, and directional
  results. Participant marker colors now derive from explicit connection state.
  A paired path is retained only after both browsers confirm its local verdict,
  preventing an asymmetric evidence result from briefly connecting and then
  closing the room channel.
- Paired probes now signal only candidates matching the requested profile.
  Local Chromium produced six STUN-assisted passes with selected
  `srflx`/`prflx` evidence. Two one-sided STUN rows still selected the
  STUN-requesting peer's own host candidate and remain inconclusive; standard
  WebRTC exposes no policy for excluding local host candidates while retaining
  srflx candidates. Direct ICE-TCP remains unsupported rather than simulated.
- The device-check drawer exposes this capability boundary before the matrix:
  it feature-tests the standard TURN relay-only policy and separately marks
  direct ICE-TCP isolated testing unsupported because JavaScript has no
  TCP-only ICE transport policy. This does not claim the browser lacks an
  internal ICE-TCP implementation.
- Capability submission now distinguishes malformed payloads from missing or
  expired room authorization. On stale authorization the client closes the dead
  attempt and returns to create/join controls with an actionable explanation.
- **Verification:** `npm run check` passed with formatting, strict TypeScript,
  ESLint, 40 Vitest tests, client build, and Worker build. `npm run
test:browser` passed 4 Chromium tests in 42.2 seconds using actual local
  Worker signaling and RTC data channels: automatic checks and intent
  withdrawal, responsive keyboard drawer behavior, 9/9 terminal matrix
  rows, bidirectional chat, common attempt IDs, complete clipboard report,
  configurable participant-coordinated performance restart, connected peer
  markers, compact summary, expired-room recovery, and guest-originated shared
  retry.
- **WebKit evidence:** the focused two-context WebKit connection scenario
  passed in 33.2 seconds and exchanged application data. This is useful engine
  coverage but does not replace confirmation on the two physical iPhones and
  their Wi-Fi.
- **Packaged artifact:** `dist/` is 544 KiB. `dist/server/` contains only the
  bundled `index.js` Worker and has no external ESM imports. `dist/client/`
  contains the Vite entry and hashed CSS/JavaScript assets.
  `dist/.openai/drizzle/` contains byte-identical copies of migrations 0001 and 0002.
- **Evidence:** screenshots outside Git are at
  `/Users/renjay/.copilot/session-state/7dc1b6c4-cd09-4eb1-8e6f-0f8009517c38/files/ux-redesign-evidence/`.
  Files cover mobile invitation/checking, mobile drawer, mobile validation
  failure, desktop waiting, connected room, diagnostics drawer, and compact
  report. They contain local ephemeral room/run/attempt references but no TURN
  credentials or participant tokens.
- **Models/delegation:** GPT-5.6 Sol medium owned contracts, integration, review,
  validation and commits. Terra medium A implemented the check engine and
  focused tests; Terra medium B implemented presentation components/styles;
  Terra medium performed the bounded `main.tsx` integration. Sol fixed
  cross-lane lifecycle/report/retry issues and completed acceptance evidence.
  Astra was not used because no exceptional blocker arose.
- **Remaining environment-dependent gaps:** no TURN credentials or external
  second network were supplied, so relay UDP/TCP/TLS allocation/connectivity,
  NAT traversal and different-network behavior remain unverified. Standard
  browser ICE-TCP isolation remains unsupported/inconclusive. This local run
  did not verify hosted owner identity or D1 behavior and made no deployment,
  provisioning, billing, or hosted-configuration changes.
- **Next hosting action:** Codex should reuse this source commit and the
  existing Sites project, confirm the intended audience, configure/verify the
  production binding and trusted owner identity, deploy, and complete hosted
  D1/auth/two-device verification. No local implementation defect is being
  deferred.

### Codex Sites deployment checklist

1. Select Terra with medium reasoning and standard speed, then read
   `KICKOFF.md`, this handoff, `SPEC.md`, `AGENTS.md`, and `BUILD_HANDOFF.md`.
2. Reuse `.openai/hosting.json`; do not create another Sites project. Inspect
   the current project and confirm the intended audience before publication if
   Sites requires that choice.
3. Run `npm ci` and `npm run check`. The production package must contain
   `dist/server/index.js`, `dist/client/`, and the exact ordered migrations in
   `dist/.openai/drizzle/`.
4. Configure or verify the logical `DB` binding, `ENVIRONMENT=production`, and
   secret `OWNER_ID`. Derive the owner value from the actual authenticated Sites
   dispatcher identity; do not infer it from local tests or commit it. To enable
   managed Xirsys TURN, also configure `XIRSYS_IDENT`, `XIRSYS_SECRET`,
   `XIRSYS_CHANNEL`, and `DIAGNOSTIC_ACCESS_CODE` as hosted secrets/settings.
5. Verify signed-out and non-owner `/api/admin/*` requests return 403, then
   verify authenticated owner list, detail, and export access.
6. Deploy with Sites tools, apply/verify both D1 migrations, and check hosted
   health, static SPA fallback, room create/join, persistence, two-device
   WebRTC/chat, reports, and owner authorization.
7. Report TURN and external-network paths as untested unless credentials and an
   appropriate network/device pair are actually available.

The remaining sections describe the earlier build and hosting handoff.

## Source and scope

- **Branch:** `work/copilot-build-handoff`
- **Source commit:** `3e25063c977e3ba6b517c74e4141a8d7c8626e9c`
- **Worktree:** `/Users/renjay/code/worktrees/webrtc-room/copilot-build-handoff`
- **Starting commit:** `d149c7b50c3182638b4781aff9993cd1e208f930`
- The application source is committed at the immutable source commit above.

The local implementation completes the SPEC flows for mandatory preflight, room
create/join, concurrent HTTP signaling, attempt generations and retry, sanitized
capability/matrix scheduling, selected WebRTC data channels, chat, candidate and
failure evidence, bounded RTT/goodput, cancellation/cleanup, local report
export/upload, and owner review routes/UI. It includes persistent report storage,
quotas, retention cleanup, and fail-closed authorization.

### Module map

- `src/shared/`: IDs and schemas, ICE/profile policy, lifecycle, normalization,
  redaction, timing, and performance math.
- `src/client/main.tsx`: room, preflight, matrix, chat, report, and `/admin`
  surfaces; `src/client/webrtc.ts`: ICE/WebRTC signaling and probes;
  `src/client/performance.ts`: coordinated RTT/goodput; `api.ts` and `report.ts`:
  validated API and local report handling.
- `src/server/worker.ts`: Worker-compatible request handler and routes;
  `repository.ts`: prepared-statement persistence boundary; `auth.ts`:
  identity seam; `db/types.ts`: D1 types; `index.ts`: Worker entry.
- `src/server/migrations/0001_initial.sql` and `0002_integrity_and_quotas.sql`:
  versioned D1-compatible schema.
- `scripts/dev.mjs`, `scripts/local-db.mjs`, `scripts/migrate-local.mjs`,
  `scripts/reset-local.mjs`: local Worker/static server and persistent database
  lifecycle. `tests/`: Vitest unit/integration and Playwright browser coverage.
- `dist/client/` and `dist/server/index.js`: current build outputs.

## Runtime, packages, and commands

Observed locally on macOS on 2026-09-06:

- Node `v23.11.0`; npm `11.12.1`.
- Playwright `1.63.0` / Chromium `Google Chrome for Testing 153.0.8010.12`.
- Package lock is npm lockfile v3. Direct versions include React `19.2.8`,
  Vite `8.2.2`, TypeScript `6.0.3`, ESLint `10.10.0`, Prettier `3.9.6`,
  Vitest `5.0.0`, sql.js `1.14.2`, zod `4.5.4`, and
  `@playwright/test` `1.63.0`. Node requirement is `>=20.19`.

Exact commands:

```sh
npm install
npm ci
npm run dev
npm run build
npm run check
npm test
npm run test:browser
npm run reset:local
npm run migrate:local
```

For UI review from another device on the same LAN:

```sh
npm run dev -- --host 0.0.0.0 --port 4173
```

Plain HTTP on a private LAN IP is not a browser-trusted secure context. The
client renders there using a `crypto.getRandomValues()` ID fallback, and device
checks report browser support separately from the HTTPS prerequisite. Real
mobile WebRTC diagnostics require trusted local HTTPS or a deployed HTTPS
origin.

`npm run dev` builds first, then serves the local Worker/static client on
loopback (default `http://127.0.0.1:4173`). `npm run build` emits
`dist/client/` and `dist/server/index.js`. Reset recreates
`.local-data/webrtc-room.sqlite` and applies the schema; migration applies
ordered unapplied migrations without resetting data. Local persistence is a
SQLite/sql.js D1-compatible adapter, not real D1 emulation.

## Verification evidence

All entries below are command output observed in the worktree on **2026-09-06
local timezone, macOS**. Evidence is command output, not screenshots. Playwright
artifacts are gitignored; the successful run retained no traces or screenshots.

| Command                                        | Outcome                                                                                                                      | Evidence scope/location                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `npm install`                                  | Passed using `package-lock.json`; versions above observed with `npm list --depth=0`.                                         | Lockfile and local install                                     |
| `npm run check`                                | Passed: Prettier format check, strict TypeScript checks, ESLint, **23 Vitest tests in 5 files**, client build, Worker build. | Output; `dist/client/`, `dist/server/index.js`                 |
| `npm test`                                     | Passed: 23 tests in 5 files (`domain`, `performance`, `repository`, `webrtc`, `worker`).                                     | Deterministic unit/integration output                          |
| `npm run reset:local && npm run migrate:local` | Passed: reset created `.local-data/webrtc-room.sqlite`; ordered Worker-compatible schema applied.                            | Local SQLite file and command output                           |
| `npm run test:browser`                         | Passed: **3 tests in approximately 2.1m**; this terminal run rounded to 2.2m, Playwright Chromium.                           | `tests/browser/rtc.spec.ts`; gitignored artifacts not retained |

The browser run used two isolated contexts and actual Worker-signaled
`RTCDataChannel`s. It verified bidirectional chat, one shared attempt ID, all
configured default matrix rows reaching terminal states, positive
receiver-measured A→B and B→A goodput, preflight invalidation after
configuration change, and retry with a new attempt ID that re-established the
main path.

Evidence boundaries:

- **Deterministic mocks/unit/integration:** Vitest covers schemas, redaction,
  lifecycle/performance calculations, signaling/generation isolation,
  idempotency, slot contention, quotas, and Worker route behavior. These do not
  prove network traversal.
- **Actual local WebRTC:** the two-context Playwright run used the local
  Worker/signaling path and real browser data channels.
- **Local persistence:** SQLite/sql.js through the D1-compatible repository
  interface was reset, migrated, and exercised. It is not a claim of hosted D1
  compatibility proof or a D1 emulator.
- **Controlled TURN:** not run; no supplied TURN credentials/service.
- **Real external network/different devices:** not run.
- **Hosted D1/Sites/auth/deployment:** not run.
- Local tabs do **not** prove NAT traversal, relay reachability, or any
  different-network behavior.

On 2026-09-07, the browser suite was rerun after the Sites integration. It
could not establish a verified local main channel in the then-current network
state: direct profiles reached their data-channel deadlines and STUN profiles
were correctly recorded as inconclusive. The suite therefore timed out at its
chat assertion. This is negative local environment evidence, not a change to
the prior successful 2026-09-06 local run and not hosted/TURN proof.

## Outstanding work

### Platform-only

The private Sites project, logical `DB` declaration, production environment,
and secret verified owner identity are configured. A non-deployed package
version containing the Worker, client assets, and ordered existing migrations
has been saved. Sites does not expose the D1 binding in its database overview
until deployment, so migration application and hosted persistence remain
pending explicit deployment authorization.

### Credentials/network-dependent

Run supplied TURN UDP, plain TCP, and TLS-over-TCP tests independently, then
validate relay-only behavior with relay evidence. Test on different devices and
networks, including external STUN reachability and relevant failure cases.

### Browser limitation

Standard browser WebRTC cannot reliably force ICE-TCP or a specific candidate
pair. Those matrix rows are truthfully reported unsupported/inconclusive where
isolation cannot be established; a host/UDP winner must not be relabeled as
TCP evidence.

### Implementation defect

No known local implementation defects remain based on the completed check,
reset/migration, and browser evidence. Hosted identity, D1, TURN, and
different-network gaps are not local defects.

## Environment, bindings, and migrations

Hosted configuration now declares the Sites project ID and logical D1 binding:

- `project_id`: platform-issued Sites project identifier persisted in
  `.openai/hosting.json`.
- `DB`: logical D1 binding, platform-provisioned.
- `ENVIRONMENT=production`: hosted runtime value.
- `OWNER_ID`: secret platform runtime value set to the verified single owner;
  it is never committed or exposed to the client.
- `XIRSYS_IDENT`: server-only Xirsys account identifier.
- `XIRSYS_SECRET`: server-only Xirsys API secret.
- `XIRSYS_CHANNEL`: Xirsys channel used for temporary TURN issuance.
- `DIAGNOSTIC_ACCESS_CODE`: randomly generated code of at least six characters,
  shared only with invited diagnostic participants.

The local development contract remains:

- `LOCAL_OWNER_ID=<LOCAL_OWNER_ID>`: development-only loopback owner value;
  leave unset unless explicitly testing `/admin` locally.
- The four Xirsys values above may be supplied as process environment variables
  for local integration testing; leave them unset for the fail-closed
  direct/STUN-only mode.

No secrets, TURN credentials, database IDs, deployed URLs, or owner identifiers
are recorded here. The existing non-secret Sites project ID is intentionally
preserved in `.openai/hosting.json`. `src/server/migrations/0001_initial.sql`
creates rooms, participants, attempts, acknowledgements, capabilities, signals,
runs, and diagnostic events. `0002_integrity_and_quotas.sql` adds event byte
accounting, the insert trigger, expiry indexes, and migration bookkeeping.

For a clean local reset:

```sh
npm run reset:local
npm run migrate:local
```

The reset is local-only and recreates `.local-data/webrtc-room.sqlite`; do not
use it against hosted D1.

## Authentication and safeguards

`ProductionIdentityAdapter` reads the Sites-dispatcher supplied
`oai-authenticated-user-email` identity, with the dispatcher user ID as a
fallback. Production admin reads remain fail closed without an authenticated
identity and a matching configured owner value. These headers are never treated
as client development headers; the loopback-only development adapter remains
separate.
`DevelopmentIdentityAdapter` is enabled only for non-production loopback
requests (`localhost`, `127.0.0.1`, or `::1`). Local admin access requires
`LOCAL_OWNER_ID` to be explicitly configured and the user to manually enter the
matching ID; the development header is never accepted on public hosts or in
production. Never trust a client public identity header as hosted
authentication. Pending hosted verification must cover signed-out, non-owner,
and owner requests, including list/detail/export.

Participant write/poll tokens are scoped and hashed; attempt generations and
probe IDs isolate signaling; inputs are schema-validated; responses are
no-store; and admin authorization is server-side on every admin endpoint.
Redaction occurs before upload and server-side. Credentials, tokens, ICE
passwords/ufrags, raw SDP, chat bodies, and probe payloads are excluded from
stored diagnostic records and exports.

## Protocol, privacy, and retention constraints

The implementation keeps the SPEC bounds: 10-second HTTP requests, 15-second
preflight probes, 30-second per-running connectivity profile deadlines,
15-minute inactive rooms, at most three STUN and six TURN URLs per device, and
bounded concurrent probes. Sequential performance traffic uses 16 KiB chunks,
a configurable 1–10 second test length (3 seconds by default), and a
configurable 8–256 MiB ceiling per direction (100 MiB by default, twice that
total). The byte ceiling is authoritative and cap-limited samples are labeled.
Diagnostic events are capped at 5,000 events or 2 MiB per run;
summary/truncation counts are retained. Signals/rooms are expiry-cleaned in
bounded batches, and report retention cleanup uses the 30-day default. Raw
signaling data is ephemeral and participant-scoped. Local reports remain
available for copy/download even if upload is pending or truncated.

## Model and delegation summary

- **Sol, medium:** root orchestrator; owned planning, module contracts,
  integration, and final review.
- **Terra, medium:** foundation, application, completion, protocol work, and
  review/fix implementation.
- **Luna, medium:** final validation and documentation.
- **Sol, medium:** focused read-only review.
- **Astra:** no escalation; no unresolved blocker justified it.

No cost or usage claims are made.

## Smallest ordered Codex next actions

1. Inspect the exact commit/diff and this evidence before changing source.
2. Apply current Sites guidance without restarting or scaffolding over the
   completed application.
3. Wire the trusted identity adapter and logical D1 binding/migrations.
4. Rebuild and rerun check, migration, and relevant browser checks.
5. Configure the verified owner identity.
6. Deploy only with user authorization and the intended audience resolved.
7. Validate hosted auth, D1 persistence, WebRTC signaling, TURN, and available
   external/different-network paths; report any remaining gaps honestly.
