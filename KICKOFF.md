# Current kickoff and historical build prompts

## Current: UX redesign in a fresh Copilot session

Select **gpt-5.6-sol**, **medium reasoning**, in the actual new session's model
selector. Open the repository containing this planning commit. No factory is
requested; use bounded subagents with one integration owner.

> Implement the approved UX redesign in UX_REDESIGN_PLAN.md and the updated
> SPEC.md. Read AGENTS.md, BUILD_HANDOFF.md, STATUS.md and HANDOFF.md first.
> This is an incremental redesign of the existing application, not a new scaffold.
> Begin implementation without repeating design approval.
>
> Make the room flow primary, automatically check each device, and put diagnostic
> depth in a drawer closed by default (desktop sidebar/mobile sheet). Correct
> preflight evidence and TURN credential handling before wiring automatic checks.
> Preserve full two-device matrix coverage, truthful transport limitations,
> scoped signaling/attempt generations, report privacy/redaction and fail-closed
> owner authorization. Keep the existing Workers/D1/Sites integration intact.
>
> Sol medium owns contracts, integration and final review. Start with at most two
> useful independent lanes: Terra medium for the check engine and its focused
> tests; Terra medium for new presentation components/styles and bounded UI tests.
> Keep main.tsx and shared integration contracts under one owner; hand off later
> bounded integration implementation to Terra rather than duplicating it. Use
> Luna medium only for narrow closeout work when useful. Reserve Astra for a
> documented exceptional blocker. Record actual assignments and outcomes.
>
> Follow the plan's acceptance checklist, including automatic invitation checks,
> explicit room intent, safe recheck/config Apply, keyboard/mobile drawer behavior,
> copy invitation, primary messaging, complete local reports/compact summary,
> bandwidth preference, and honest STUN/TURN/UDP/TCP evidence. Use existing tests
> and actual local browser/network evidence; do not replace real RTC assertions
> with fixtures or claim external paths passed without the required environment.
>
> Work locally in a topic worktree according to Git hooks. No deployment,
> provisioning, remote creation, billing change, or factory is authorized.
> Preserve existing changes and hosted configuration. Keep STATUS.md current,
> commit coherent milestones, and finish with HANDOFF.md recording the exact
> commit/branch/worktree, actual evidence locations and unavoidable limitations.
> Historical build/deployment notes are context, not proof of current behavior.

## Historical: original local build

### Original Copilot build prompt

Open this repository in Copilot and select **Sol** as orchestrator, with **medium reasoning** where supported. Terra, Sol, Astra and Luna are available in this subscription; use the roles below. Settings are controlled by Copilot, not by this document.

> Build the complete local WebRTC diagnostic app specified in SPEC.md. Read AGENTS.md and BUILD_HANDOFF.md first, and follow .github/copilot-instructions.md. You are the primary local builder; do as much implementation and validation as possible in Copilot before handing back to Codex for Sites integration and deployment.
>
> Start with a browser-tested feasibility slice for transport isolation, concurrent signaling and selected-path verification, then complete the UI, backend, real local persistence, diagnostics, connectivity matrix, performance probes, owner authorization logic and review UI. Establish and run static-analysis guardrails plus meaningful unit, database integration and browser tests. Preserve the Sites/Cloudflare Workers and D1 compatibility contract. Do not stop at a scaffold, frontend mock or plan because Sites tools are unavailable. Test authentication locally through a safe development/test adapter; keep production fail-closed and document the real ChatGPT identity wiring needed later.
>
> There are no session/token budget constraints. Use Sol for orchestration, module contracts, integration and review; Terra for most bounded implementation and tests; Luna for narrow mechanical tasks; Astra only for justified difficult blockers. Delegate concise non-overlapping work and avoid duplicate implementation or blanket reviews. Choose reasoning effort judiciously; do not assume Copilot billing matches Codex or switch billing. No paid-service provisioning or deployment is authorized.
>
> Keep everything local. Follow the repository's worktree/commit hooks, maintain STATUS.md, commit coherent changes, and finish with an evidence-backed HANDOFF.md following BUILD_HANDOFF.md. Clearly distinguish actual tests from simulations and list only unavoidable platform/credential/network work for Codex. Continue without repeating planning approval unless a material unresolved product decision requires it.

## Historical: Codex hosting handoff

Select Terra, medium reasoning, standard speed where available. Open the same repository and use:

> Continue this Copilot-built project. Read HANDOFF.md, SPEC.md, AGENTS.md and BUILD_HANDOFF.md. Inspect the implementation and validation evidence; preserve and reuse the existing app. Use the current Sites skills to complete only the required platform integration, production identity/owner authorization, D1/Worker configuration, packaging and hosted validation. Do not rebuild the app from scratch. Prepare it for Sites deployment and resolve the intended audience with me before publication. Follow the judicious Codex model policy and report any remaining external-network/TURN verification gaps.
