# Prompts for the two phases

## Start in Copilot now

Open this repository in Copilot. Choose an appropriate model available in your subscription; Codex model names/settings are not prerequisites.

> Build the complete local WebRTC diagnostic app specified in SPEC.md. Read AGENTS.md and BUILD_HANDOFF.md first, and follow .github/copilot-instructions.md. You are the primary local builder; do as much implementation and validation as possible in Copilot before handing back to Codex for Sites integration and deployment.
>
> Start with a browser-tested feasibility slice for transport isolation, concurrent signaling and selected-path verification, then complete the UI, backend, real local persistence, diagnostics, connectivity matrix, performance probes, owner authorization logic and review UI. Establish and run static-analysis guardrails plus meaningful unit, database integration and browser tests. Preserve the Sites/Cloudflare Workers and D1 compatibility contract. Do not stop at a scaffold, frontend mock or plan because Sites tools are unavailable. Test authentication locally through a safe development/test adapter; keep production fail-closed and document the real ChatGPT identity wiring needed later.
>
> There are no session/token budget constraints. Use subscription-available models judiciously and delegate only bounded useful tasks. Do not require unavailable Terra/Luna/Sol/Astra models or switch billing to obtain them. No paid-service provisioning or deployment is authorized.
>
> Keep everything local. Follow the repository's worktree/commit hooks, maintain STATUS.md, commit coherent changes, and finish with an evidence-backed HANDOFF.md following BUILD_HANDOFF.md. Clearly distinguish actual tests from simulations and list only unavoidable platform/credential/network work for Codex. Continue without repeating planning approval unless a material unresolved product decision requires it.

## Return to Codex later

Select Terra, medium reasoning, standard speed where available. Open the same repository and use:

> Continue this Copilot-built project. Read HANDOFF.md, SPEC.md, AGENTS.md and BUILD_HANDOFF.md. Inspect the implementation and validation evidence; preserve and reuse the existing app. Use the current Sites skills to complete only the required platform integration, production identity/owner authorization, D1/Worker configuration, packaging and hosted validation. Do not rebuild the app from scratch. Prepare it for Sites deployment and resolve the intended audience with me before publication. Follow the judicious Codex model policy and report any remaining external-network/TURN verification gaps.
