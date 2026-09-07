# Project instructions

## Source of truth

Read SPEC.md before implementing. It defines the agreed WebRTC diagnostic foundation and its acceptance criteria. Keep it current when the user changes scope. This file defines working/model/cost policy, not a replacement product spec. A request to implement authorizes the work; do not re-ask merely because SPEC.md says it was prepared for review.

## Cost and model routing

Optimize for the user's existing ChatGPT/Codex allowance. No fixed cash budget is authorized. Do not purchase credits, redeem reset credits, switch to paid API billing, or provision paid external services without explicit user authorization. If remaining allowance becomes limiting, preserve a handoff and discuss options with the user.

- Preferred root orchestrator: gpt-5.6-terra, medium reasoning, standard speed. The app/model selector controls the actual root model; this file cannot switch it. If a mismatch is known, disclose it before substantive implementation and explain how to select Terra. Do not claim a switch occurred without evidence.
- Terra: normal implementation, integration, orchestration, meaningful tests, and routine debugging.
- Luna (gpt-5.6-luna, low or medium): tightly scoped fixtures, simple UI/test proposals, documentation and mechanical tasks with clear acceptance criteria.
- Sol (gpt-5.6-sol, medium; high only for a demonstrated need): bounded protocol/concurrency/security review or investigation after two unsuccessful evidence-based fixes to the same blocker. Do not routinely duplicate all work with Sol.
- Astra: exceptional escalation only; explain the blocker and seek the user's approval before starting an Astra subtask.
- Avoid high/max/ultra reasoning and premium/fast speed by default. Increase effort only for a concrete reason. Do not silently substitute a more costly model when a requested model is unavailable.

The user authorizes bounded subagent delegation under this routing. Delegate only when useful independent work exists; default to at most two active subagents and fewer when coordination costs dominate. Specify model and effort explicitly. For model overrides, use a fresh/minimal context (fork_turns="none" or a supported limited history), with only relevant requirements, files and acceptance criteria. Do not fork this entire conversation. Ask for concise findings/proposed patches and evidence; avoid repeated broad reviews. Record each delegation's model, purpose and outcome in the milestone handoff.

Sites ownership rules apply: the root owns Site checkout edits, Sites tools, registration, credentials, source/version operations and deployment. Subagents provide bounded read-only reviews, fixtures or proposed patches for root integration. They do not edit or initialize the Site or deploy it. Do not reimplement the same solution merely to integrate a reviewed patch.

Check account usage at implementation start and at meaningful milestones when the usage tool is available, not on every tool call. These are account-wide windows, not precise project costs. Report actual readings and uncertainty; never fabricate dollar/token attribution or guarantee enough allowance remains. Keep prompts, output, searches and context bounded; do not spend more on monitoring than it saves.

## Work sequence and evidence

Start with the smallest browser-tested feasibility slice for isolated ICE transport tests, concurrent signaling and candidate-path verification. Resolve browser limitations before building the entire UI around a strict transport-selection promise. Then implement incrementally under SPEC.md without silently dropping unsupported matrix rows.

Keep modules separated as specified. Establish strict TypeScript/lint/import guardrails and meaningful unit/integration/browser tests early. Do not weaken checks to hide a failure. Real WebRTC smoke tests and authorization tests are required; mocks cannot prove network traversal. Record untested TURN/network cases explicitly when credentials or a suitable environment are unavailable.

Keep secrets out of code, Git, diagnostic records and exports. Preserve scoped tokens, owner-only server authorization and log bounds. Use local-only development until the user requests deployment, or the active task otherwise authorizes hosted delivery under Sites rules. Never infer public publishing from room-based access requirements alone.

At each meaningful milestone update a short STATUS.md with completed work, verification evidence, unresolved issues, next action, delegation summary and available account-usage snapshot (no credentials or account identifiers). Commit coherent changes. Do not create a separate GitHub repository, switch billing, or add unrelated product scope without user direction.
