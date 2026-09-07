# Implementation kickoff

Select **gpt-5.6-terra**, **medium reasoning**, and **standard speed** in the app before starting. Model selection is an app setting; this prompt and AGENTS.md do not switch the root model.

Paste this prompt in a task rooted at `/Users/renjay/code/webrtc-room`:

> Implement the full WebRTC diagnostic foundation defined in SPEC.md. Read and follow AGENTS.md for module boundaries, model routing, delegation, and validation. Begin with a browser-tested feasibility slice for ICE transport isolation, concurrent signaling, and selected-path verification; then continue through the complete implementation and required tests. Preserve and document browser limitations rather than claiming unsupported paths work or silently dropping test coverage.
>
> Use Terra as the main orchestrator, Luna for narrow well-defined tasks, Sol for focused complex reviews or blockers, and Astra only for justified exceptional escalation. Keep subagent assignments concise and avoid duplicate work. Follow Sites ownership rules when integrating subagent proposals.
>
> There are no session or token budget constraints for this work. Do not pause for allowance checkpoints or reduce scope to save tokens. Be judicious about model cost and reasoning effort. Do not purchase credits, redeem resets, change billing, or provision paid external services without my authorization.
>
> Keep the work local for now. Establish static-analysis guardrails and meaningful unit, database integration, and browser tests early. Run the applicable checks and complete available validation; clearly identify external-network or TURN checks that cannot be verified without credentials or suitable infrastructure. Maintain STATUS.md with progress, evidence, remaining issues, and model escalations. Commit coherent changes. Proceed without repeating planning approval unless a material unresolved product decision is required.
