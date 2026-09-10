# Copilot build and Codex Sites handoff

## Responsibility boundary

Copilot builds the actual app locally, including backend services and persistence, not just a design or frontend mock. Codex later adds/verifies the hosted Sites integration. Local implementation is not blocked by missing Sites credentials/tools. The only deferred work should depend on the hosting platform, real user identity, unavailable external credentials, or a network environment that cannot be reproduced locally.

## Preserve the deployment contract

- Use TypeScript and a Cloudflare Workers-compatible ESM backend with HTTP Request/Response handlers. Keep the browser WebRTC engine separate from server code.
- Prefer an available Sites/Vinext starter and preserve its package manager, lockfile and generated conventions. Installed Sites guidance at planning time used `@openai/create-sites@0.3.0` with `shadcn,d1,auth` add-ons and `@openai/sites-vite-plugin`. These are recorded compatibility references, not permission to bypass dependency policy or overwrite this nonempty repo. Check package availability/help before use; generate into an empty temporary directory if needed, then integrate deliberately while preserving docs/Git.
- If the starter is unavailable, keep framework/runtime seams thin and document the exact outstanding integration. Do not replace the target with an Express-only backend, a Vercel-only runtime, Firebase, Supabase or another hosted database. Do not spend the entire build trying to acquire an unavailable private package.
- Target a Worker entrypoint exporting a default object with callable `fetch(request, env, ctx)`; Sites convention is `dist/server/index.js` plus public assets in `dist/client/`. If a local toolchain emits different paths, document them and the adaptation needed. An actual backend build is required, not a static export pretending to implement APIs.
- Use D1-compatible schema/migrations and prepared statements behind a narrow repository layer. Prefer local D1 emulation through supported Workers tooling; exercise real local persistence and restart durability. If emulation is unavailable, a SQLite fallback must be explicitly labeled and D1 runtime tests remain pending. Avoid an in-memory or browser-storage substitute for durable product data.
- Keep logical `d1: "DB"` and unused `r2: null` declarations in `.openai/hosting.json` if generated. Do not invent a `project_id`, production database IDs, deployed URLs, or credentials. Preserve any real existing identity when resuming. Do not provision Cloudflare resources or publish with Wrangler.
- No raw TCP server/database clients, always-running daemon assumptions, filesystem persistence in the production backend, or unsupported scheduler dependencies. Browsers communicate with STUN/TURN; the hosted Worker handles HTTP signaling/logs only.

## Complete locally in Copilot

Implement every SPEC.md flow: mandatory preflight; room lifecycle and concurrent HTTP signaling; five bounded capability checks with ordered endpoint fallback and pair details; policy and truthful capability reporting; selected data channel/text demo; timers/candidates/failure evidence; correlated local and persistent reports; RTT/goodput probes; owner review UI; redaction, quotas, retention and authorization logic. Handle cancellation, races, retry generations, backpressure and resource cleanup. Missing hosted auth must not postpone the rest of admin UI, policy and tests.

Establish static analysis and unit/integration/browser tests early, then run them. Use actual browser WebRTC for smoke/connectivity evidence. Use fake clocks/RTC adapters only for deterministic protocol/error/math tests. Run controlled local TURN integration when feasible with already available local test infrastructure and temporary credentials; no default production TURN service or committed secrets. External-network/real TLS tests that are unavailable remain explicit gaps, not passing tests.

Document exact package-manager commands for install, dev, local migrations/reset, static checks, unit/integration/browser tests and production build. Keep credentials out of fixtures, snapshots, source, reports and screenshots.

## Authentication boundary

Implement owner authorization as a pure server policy fed by a small trusted identity adapter. Production identity must come from the Sites dispatcher/auth helpers, with a configured stable site-specific owner ID. Never trust an arbitrary public request header as authenticated identity on a standalone local server.

For local owner/non-owner/signed-out testing, use injected identities in tests, and if interactive dev access is needed, an explicit loopback-only development mechanism. Test that development identity support is unavailable in production and that missing production identity/owner configuration fails closed. Do not ship an impersonation query parameter, unrestricted fake-login endpoint, first-login ownership, or a custom OAuth stack. If generated Sites helpers exist, retain them and their reserved dispatcher routes; do not invent handlers for `/signin-with-chatgpt`, `/signout-with-chatgpt`, or `/callback`.

Codex verifies the actual platform auth path and trusted header boundary, configures the real owner identity, and tests signed-out/non-owner rejection and owner read/export on the hosted Site. Copilot tests the same authorization semantics locally. These are complementary checks, not interchangeable proof.

## Required HANDOFF.md from Copilot

Before returning work, create/update HANDOFF.md containing:

1. Exact branch, source commit and worktree; file/module map and completed SPEC.md requirements.
2. Runtime/package versions, install/dev/build/test/migration commands and output paths.
3. Verification results: command, outcome, date, relevant browser/OS, and evidence locations. Separate mocks, actual local WebRTC, emulated D1, controlled TURN, and real external-network results.
4. Outstanding work categorized as platform-only, credentials/network-dependent, browser limitation, or implementation defect. Fix implementation defects locally where possible; do not transfer ordinary unfinished work merely because Codex can finish it.
5. Environment variable names/purpose and logical bindings, with placeholders only; schema/migration inventory and local-data reset instructions.
6. Production auth adapter seam, local identity simulation safeguards, and pending real owner/platform verification.
7. Known protocol constraints, test coverage gaps, diagnostics redaction/retention settings, model escalation summary, and the smallest next Codex actions.

Keep STATUS.md current during work. Commit source, tests, migrations and documentation; exclude dependencies, caches, build outputs, credentials and local databases. Do not copy the whole project to another repo for the handoff.

## Codex hosting phase

Read HANDOFF.md, SPEC.md and AGENTS.md; inspect the actual diff and test evidence. Use current Sites building/hosting skills for authoritative platform details. Reuse the completed app, lockfile, schema and architecture; make only necessary integration fixes. Do not restart the project or rerun a scaffold over it.

Finish any Sites-specific package/plugin/Worker output wiring, provision via Sites tools, persist the real project ID, configure logical D1 bindings and hosted runtime values, generate/inspect migrations as needed, and configure verified owner identity. Rebuild after integration changes and run relevant checks; inspect packaged artifacts and production auth configuration.

Deploy only when the user authorizes hosted delivery and the intended audience is resolved. Verify deployment success, hosted HTTP/D1 behavior and actual owner-only diagnostic access. Validate available two-device/network/TURN paths in the hosted environment. Report missing external test coverage honestly and preserve local evidence. Production TURN remains supplied by users. Return the live URL and concise remaining limitations.
