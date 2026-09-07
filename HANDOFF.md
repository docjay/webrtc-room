# Copilot build handoff

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
npm run dev
npm run build
npm run check
npm test
npm run test:browser
npm run reset:local
npm run migrate:local
```

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

## Outstanding work

### Platform-only

Provision the logical Sites `DB` binding, configure the verified stable owner
identity, and perform hosted validation/deployment only after authorization.

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

Use placeholders only when configuring hosting:

- `DB`: logical D1 binding (`DB`); hosted value is platform-provisioned.
- `OWNER_ID`: stable site-specific production owner ID, placeholder
  `<OWNER_ID>`, never a client-supplied value.
- `ENVIRONMENT=production`: selects production fail-closed identity behavior.
- `LOCAL_OWNER_ID=<LOCAL_OWNER_ID>`: development-only loopback owner value;
  leave unset unless explicitly testing `/admin` locally.

No secrets, TURN credentials, project IDs, database IDs, URLs, or owner
identifiers are recorded here. `src/server/migrations/0001_initial.sql`
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

`ProductionIdentityAdapter` reads only the Sites-dispatcher supplied
`oai-authenticated-user-id` header, and production admin reads remain fail
closed without it or without a matching configured owner ID. This header is
never treated as a client development header; the loopback-only development
adapter remains separate.
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
15-minute inactive rooms, at most three STUN and six TURN URLs per device,
bounded concurrent probes, and sequential bounded performance traffic (16 KiB
chunks, at most 5 seconds or 8 MiB per direction, 16 MiB total plus protocol
overhead). Diagnostic events are capped at 5,000 events or 2 MiB per run;
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
