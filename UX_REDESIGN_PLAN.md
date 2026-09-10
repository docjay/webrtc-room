# UX redesign implementation plan

Scope update (2026-09-09): the user's five-category capability diagnostic
supersedes the exhaustive-matrix requirements below. See SPEC.md. Diagnostics
now uses a wider desktop drawer and Summary/Pair details views; the detail view
shows actual attempts and untried fallbacks without running extra tests.

Status: approved design direction, implementation not started.
Prepared 2026-09-07 against source baseline `4060f76`.
This is a local implementation plan, not deployment authorization.

## Goal and agreed changes

Make connecting two devices the primary experience. Preserve the diagnostic
foundation without making participants navigate its internals.

- Diagnostics live in a drawer, closed by default. Desktop uses a side panel;
  mobile uses a full-screen sheet.
- Device checks start automatically on page load, including invitation visits.
  Remove the mandatory Run diagnostics click, not the checks themselves.
- Keep Recheck device inside diagnostics. Do not require a page refresh, which
  loses in-memory credentials/report data and interrupts a room.
- Show one understandable primary status and the next action on the room
  surface. Background diagnostic progress does not obscure usable messaging.
- Keep advanced ICE settings, endpoint evidence, candidates, matrix, timings,
  performance detail, and logs out of the default room view.
- Preserve local export after failure and owner-only persisted diagnostic access.

SPEC.md is the product source of truth. This plan supplies sequencing, boundaries,
and acceptance details for the next Sol session. No new product approval is needed
for this direction; ask only about material decisions not resolved here.

## Main flow and visual hierarchy

The following are layout sketches, not screenshots or measured network results.

```text
START
WebRTC Room                                      Diagnostics

Connect two devices
Open an invitation, or start a room to share.

[ Create a room ]     [ Enter room code ]
Checking this device...

Short diagnostic-storage notice and automatic bandwidth preference/budget

INVITATION
WebRTC Room                                      Diagnostics

Join room ABC 123
[ Join room ]
Checking this device...

WAITING
WebRTC Room                                      Diagnostics

Waiting for the other device
Room code     ABC 123
[ Copy invitation ]

This device: ready      Other device: waiting
Leave room

CONNECTED
WebRTC Room                                      Diagnostics

Connected                      Network checks continuing
You and the other device

Messages
[ Write a message...                         ] [ Send ]

Leave room
```

Create/Join may capture explicit intent during checks, with a visible pending
state. Do not issue room operations until the current checks finish with valid
required configuration and browser support. A join URL preselects the room and
join flow; it does not silently occupy a guest slot before explicit user action.
Disable duplicate submissions and allow withdrawal of pending intent.

Use a primary button for the next action; distinguish secondary actions and
Leave. Once in a room, replace Create/Join controls with room-relevant controls.
Use plain-language phases: checking device, creating/joining room, waiting for
the other device, connecting, connected, disconnected, and unable to connect.
Keep waiting for the peer's checks distinct from active connection negotiation.
Show failures with an actionable retry/recheck/change-code action, not raw errors
alone. Keep technical errors in diagnostics.

## Diagnostics drawer

```text
Diagnostics                                  Recheck   Close

This device        Checks complete
Connection         Direct UDP
Network tests      4 of 7 complete

> Device checks
> Connection paths
> Performance
> Advanced network settings
> Event log and timing

Attempt/run reference        Saved / pending / upload failed
Copy report                  Download report
Compact report
```

- Summaries reflect actual evidence; never seed a successful route or result.
- Desktop drawer must leave room controls usable. Use a non-modal labelled
  region there; mobile sheet is modal with focus containment, Escape/close,
  background inertness, and focus restored to the opener. Do not trap focus in
  the non-modal desktop panel. Handle viewport changes while open.
- Do not auto-open the drawer or move focus for normal diagnostic progress.
  Critical actionable failures appear on the main surface with a details link.
- Recheck is for device/preflight checks, not an ambiguously named full-matrix
  restart. Separate device checks from paired connectivity and performance.
- Before room creation, recheck replaces current results but retains bounded
  previous evidence. In an active room, explain and confirm any interruption
  before recheck/configuration changes initiate the coordinated retry flow.
- Advanced settings use a draft and explicit Apply, with field-level validation;
  typing JSON must not repeatedly cancel an active connection. Applying valid
  settings automatically checks the new configuration.
- Compact report is a real screenshot-friendly summary of identity, state,
  coverage, failures, path, measurements, and save status. Do not simply hide
  every result section as the current CSS does.
- Main-view status, drawer, compact view, copy, and JSON use the same report
  snapshot. Filters/closed sections must not narrow a complete LOCAL export.
- Remove owner/deployment explanatory cards from the participant page. Keep
  `/admin` and its authorization boundary; a quiet navigation link is sufficient.
  A broader owner review redesign is not part of this milestone.

## Correct automatic device checks

Device-only checks cannot prove end-to-end reachability to an absent peer.

| Track | Required evidence and interpretation |
| --- | --- |
| Browser | Secure context, required WebRTC/data-channel APIs, and required runtime capabilities; unsupported prerequisites block room operations with an explanation. |
| Signaling | Bounded service reachability check; distinguish unavailable service from an endpoint probe failure and provide retry. |
| Local gathering | Gather without STUN/TURN to record exposed local candidate types/protocols. Gathering is not a successful peer connection. |
| STUN endpoints | Probe each enabled endpoint independently. Require mapped-address (`srflx`) evidence associated with the isolated probe; host-only gathering is not STUN success. |
| TURN endpoints | Probe each configured UDP/TCP/TLS URL separately with its credentials in memory and relay-only gathering. Require relay-allocation evidence; do not equate allocation with working paired connectivity. |
| Coverage | Distinguish not configured, unsupported, inconclusive, timeout, cancelled, and failure. Missing TURN is informational. A timeout does not establish general UDP blocking. |

Preserve full RTCIceServer data inside the browser adapter, never in returned
results, identifiers, logs, or exports. Normalize RTCIceCandidate objects and
RTCStats records through appropriate separate inputs: candidate.toJSON() is not
the same shape as a candidate stats record. Preserve browser omissions honestly.
Do not add an ad hoc SDP parser if standard candidate properties suffice.

Use bounded concurrency, per-probe deadlines, cancellation and resource cleanup.
Catch synchronous RTC construction failures as explicit check results rather than
leaving the UI stuck running. Configuration versions and check generations must
prevent late results from unlocking room actions after an edit, cancellation,
network change, recheck, unmount, or room retry. Coalesce duplicate triggers.

Run checks on load, on applied configuration changes, and on supported detected
network changes. Do not invent reliable network-change detection where the browser
lacks it. Clear stale readiness immediately; preserve explicit user control over
disruptive active-session retries. Manual recheck covers undetected changes.
Never launch throughput on page load.

Actual direct UDP and TURN-assisted UDP/TCP/TLS connectivity remains in the
two-device matrix, automatically scheduled after both peers are ready. Preserve
the existing manifest acknowledgement, profile isolation, bounded scheduling,
selection policy and terminal evidence requirements. Direct ICE-TCP is not TURN
TCP; report unsupported isolation rather than a fake TCP success. HTTPS service
reachability is not proof that TURN TCP/TLS works.

Show the automatic performance preference and traffic cap before connecting.
Honor either participant's opt-out before scheduling bandwidth traffic; use the
existing host-coordinated protocol with explicit preference synchronization if
needed. Preserve RTT/goodput distinctions, cancellation and caps. Do not introduce
competing performance probes or infer bandwidth from candidate gathering.

## Concrete code findings to address

These are source-review findings, not results of a new browser run:

- `src/client/main.tsx`: most UI and async orchestration share one component;
  preflight flattens configuration to URLs; readiness does not include browser
  capability checks; configuration edits immediately tear down active resources.
- `src/client/webrtc.ts:probeIce`: receives only a URL, drops TURN credentials,
  counts any gathered candidate as success, and constructs RTC before its cleanup
  scope. Correct these together with automatic checks.
- `src/shared/normalization.ts`: expects stats-style `candidateType`, while
  preflight passes candidate.toJSON(). Establish truthful candidate evidence
  before rendering a green status.
- `src/client/main.tsx`: technical diagnostics are open by default, room sharing
  is plain text, and connection state is duplicated in technical strings.
- `src/client/styles.css`: compact mode hides the report content rather than
  presenting a summary; the common button style gives little action hierarchy.
- `src/client/report.ts` and export callers: copy currently serializes event text,
  whereas JSON adds preflight/matrix. Unify complete local report content for this
  redesign without weakening redaction or owner authorization.
- `tests/browser/rtc.spec.ts`: selectors assume a mandatory button and always-open
  technical sections. Its "Main ready:" assertion can match a label rather than
  prove a usable connection; assert explicit state and actual chat instead.

## Module contracts and ownership

Sol medium owns integration and contracts. Agree on these contracts before
parallel edits; preserve working browser/server seams instead of rebuilding.

| Scope | Suggested files/modules | Owner |
| --- | --- | --- |
| Check engine | New device-check domain/controller modules, `webrtc.ts` preflight adapter, candidate normalization, focused unit tests | Terra medium A |
| Presentation | New room/drawer/report UI components, styles, responsive/accessibility UI tests against agreed view models | Terra medium B |
| Integration | `main.tsx`, app/session hook extraction, report snapshot/export wiring, room/performance coordination, shared schema/API changes if required, existing paired browser suite | Sol integration owner; hand off bounded implementation to Terra after a lane completes |
| Closeout | Documentation/evidence organization after actual results exist | Luna medium, optional and narrowly scoped |

The check engine exposes typed snapshot/result data, current generation/config
version, progress, blocking prerequisites, and start/cancel/recheck operations.
Its result is independent of React. Components consume typed view models and
callbacks; they do not negotiate ICE, query SQL, or reinterpret raw evidence.
Separate room intent/state from device-check state and diagnostic matrix state.
Do not introduce another contradictory lifecycle model beside existing domain
state; reconcile/extract the state owner during integration.

Do not have two agents edit `main.tsx` or shared contracts concurrently. New
presentation modules allow useful independent work without duplicate refactors.
Agent UI fixtures are development/test evidence only, never production fallbacks.
Default to two active agents; do not launch a factory or a blanket review team.
Use Terra for substantial integration implementation once the first lanes finish;
Sol should not routinely rewrite reviewed Terra patches.

## Implementation sequence

1. Establish the clean topic worktree, read current docs, inspect actual source,
   and record current browser behavior at desktop/mobile sizes. Treat historical
   STATUS/HANDOFF success claims as history, not current proof. The last recorded
   local browser rerun failed to establish a main channel.
2. Define the small shared check/result and UI contracts. Implement the corrected
   probe engine with focused deterministic tests before making it automatic.
   In parallel build the room and drawer components against those contracts.
3. Integrate the initial/invitation/check/waiting/connected/failure flows. Wire
   automatic checks, safe apply/recheck/retry, peer status, copy invitation and
   accessible drawer interactions. Remove public implementation-note cards.
4. Integrate diagnostic summaries, complete exports/compact report, save status,
   performance preference/budget and cancellation. Preserve the full matrix and
   correlated report semantics; fix tightly coupled defects, not unrelated areas.
5. Run targeted deterministic and browser coverage, then the repository check
   command and relevant real two-context browser suite. Inspect actual responsive
   screens and retain screenshots/traces outside Git. Address failures without
   replacing real WebRTC evidence with mocks.
6. Update STATUS.md and HANDOFF.md with exact branch/commit/worktree, actual
   commands/results/evidence, model assignments/outcomes, and remaining gaps.
   Commit coherent changes; do not deploy or change hosted configuration.

## Acceptance checklist

### Participant experience

- Diagnostics are closed by default on desktop and mobile; no TURN JSON, raw
  IDs, candidates, logs, or owner/deployment notes compete with the primary task.
- Fresh and invitation visits start device checks automatically without a click.
  Invitations retain their code through checks/errors/recheck.
- A create/join intent cannot bypass current prerequisites or submit twice.
  Failed/timed-out network probes alone do not block an otherwise viable room.
- Waiting view shows two participant slots, room code and a usable copy-invite
  action with success/failure feedback. Connected messaging is immediately visible.
- Main connection status is distinct from continuing diagnostic progress.
- Keyboard users can operate forms, drawer, messages, recheck and exports.
  Focus is visible/restored appropriately; status announcements are concise.
- At 390px and 1440px viewport widths there is no page-level horizontal overflow;
  technical tables can scroll within their container and the mobile sheet scrolls.
- Loss of signaling/peer/channel and invalid/full/expired room errors have clear
  recovery actions. Ordinary progress never steals focus or forces logs open.

### Probe and lifecycle correctness

- Host-only gathering cannot pass a STUN check; only relay evidence can pass
  relay allocation. Candidate normalization handles both standard candidate and
  stats objects without inventing unavailable fields.
- TURN UDP/TCP/TLS checks retain credentials only in the RTC call. Results and
  exports contain none; failure/sanitization cases are tested.
- Missing WebRTC/secure context, RTC constructor errors, endpoint timeout,
  cancellation, edits during checks and stale completions terminate coherently.
- Applying a draft is the only settings action that changes active config.
  Recheck/retry cannot resurrect old attempts or silently destroy current state.
- All declared matrix rows reach truthful terminal outcomes; no first winner
  stops remaining rows. Application traffic, not allocation, proves connectivity.
- Either peer can prevent automatic bandwidth traffic. No automatic throughput
  occurs before the matrix completes; existing caps/cancel semantics remain.

### Reports and regression evidence

- Main summary, drawer, compact report, copy and JSON agree on run/attempt ID and
  current outcome. Export includes complete local evidence even with filters set,
  the drawer closed, a failure, or a retry; remote persisted reports stay private.
- Save/pending/failure/truncation states are truthful. Clipboard failures surface.
- Update existing browser tests for automatic checks; preserve real host/guest
  signaling, bidirectional messages, matrix terminal counts and retry generation
  assertions. Add deterministic UI/error cases separately from real network cases.
- Use existing `npm test -- <target files>`, `npm run test:browser -- <selector>`,
  type/lint/build commands as appropriate, then `npm run check`. Restore locked
  dependencies only after a missing-dependency failure; do not add new tools just
  for this redesign. Do not reset unrelated local databases.
- Capture desktop/mobile room, waiting, connected, drawer, failure and compact
  views with secrets excluded. Label mock scenarios separately from actual RTC.
- Without supplied TURN/service credentials or a second external network,
  allocation/NAT/TLS reachability remains explicitly unverified. Do not provision
  a relay service or call local tests proof of hosted owner security.

## Fresh-session handoff

Use the current UX kickoff in KICKOFF.md with Sol selected at medium reasoning.
This planning session is running Astra; no escalation investigation, implementation,
or subagent delegation was performed. The next session must select the intended
root model through the actual session selector rather than claiming this document
changes it. No factory, billing change, hosting change, or deployment is requested.
