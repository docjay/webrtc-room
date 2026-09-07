# Project instructions

## Source of truth

Read SPEC.md before implementing. It defines the agreed WebRTC diagnostic foundation and its acceptance criteria. Keep it current when the user changes scope. This file defines working/model/cost policy, not a replacement product spec. A request to implement authorizes the work; do not re-ask merely because SPEC.md says it was prepared for review.

## Model routing and efficient execution

The user has removed session/token budget constraints for this work. Complete the agreed scope and validation without allowance-driven pauses, token budgets, or reduced coverage. Remain judicious about model choice, reasoning effort, context size, and delegation. This does not authorize purchasing credits, redeeming resets, switching billing, or provisioning paid external services.

- Preferred root orchestrator: gpt-5.6-terra, medium reasoning, standard speed. The app/model selector controls the actual root model; this file cannot switch it. If a mismatch is known, disclose it before substantive implementation and explain how to select Terra. Do not claim a switch occurred without evidence.
- Terra: normal implementation, integration, orchestration, meaningful tests, and routine debugging.
- Luna (gpt-5.6-luna, low or medium): tightly scoped fixtures, simple UI/test proposals, documentation and mechanical tasks with clear acceptance criteria.
- Sol (gpt-5.6-sol, medium; high only for a demonstrated need): bounded protocol/concurrency/security review or investigation after two unsuccessful evidence-based fixes to the same blocker. Do not routinely duplicate all work with Sol.
- Astra: exceptional, bounded escalation when Sol has not resolved a significant blocker or a specific critical issue warrants deeper analysis. Record the evidence and reason for escalation; do not use Astra for routine orchestration or duplicate general reviews. Model escalation within this policy does not require a separate approval checkpoint.
- Avoid high/max/ultra reasoning and premium/fast speed by default. Increase effort only for a concrete reason. Do not silently substitute a more costly model when a requested model is unavailable.

The user authorizes bounded subagent delegation under this routing. Delegate only when useful independent work exists; default to at most two active subagents and fewer when coordination costs dominate. Specify model and effort explicitly. For model overrides, use a fresh/minimal context (fork_turns="none" or a supported limited history), with only relevant requirements, files and acceptance criteria. Do not fork this entire conversation. Ask for concise findings/proposed patches and evidence; avoid repeated broad reviews. Record each delegation's model, purpose and outcome in the milestone handoff.

Sites ownership rules apply: the root owns Site checkout edits, Sites tools, registration, credentials, source/version operations and deployment. Subagents provide bounded read-only reviews, fixtures or proposed patches for root integration. They do not edit or initialize the Site or deploy it. Do not reimplement the same solution merely to integrate a reviewed patch.

Do not poll account usage or insert allowance checkpoints unless the user asks or an actual service limit interrupts work. Keep context and output focused; avoid redundant searches, repeated broad reviews, and unnecessary agent coordination. Use the least costly model that can reliably do the task, escalating when evidence justifies it rather than repeatedly spending on failed attempts. Never invent dollar/token attribution.

## Work sequence and evidence

Start with the smallest browser-tested feasibility slice for isolated ICE transport tests, concurrent signaling and candidate-path verification. Resolve browser limitations before building the entire UI around a strict transport-selection promise. Then implement incrementally under SPEC.md without silently dropping unsupported matrix rows.

Keep modules separated as specified. Establish strict TypeScript/lint/import guardrails and meaningful unit/integration/browser tests early. Do not weaken checks to hide a failure. Real WebRTC smoke tests and authorization tests are required; mocks cannot prove network traversal. Record untested TURN/network cases explicitly when credentials or a suitable environment are unavailable.

Keep secrets out of code, Git, diagnostic records and exports. Preserve scoped tokens, owner-only server authorization and log bounds. Use local-only development until the user requests deployment, or the active task otherwise authorizes hosted delivery under Sites rules. Never infer public publishing from room-based access requirements alone.

At each meaningful milestone update a short STATUS.md with completed work, verification evidence, unresolved issues, next action, delegation summary including reasons for any model escalation (no credentials or account identifiers). Commit coherent changes. Do not create a separate GitHub repository, switch billing, or add unrelated product scope without user direction.
