# Copilot repository instructions

Read AGENTS.md, SPEC.md and BUILD_HANDOFF.md before implementation. KICKOFF.md contains the current Copilot build prompt and later Codex handoff prompt.

Copilot owns the complete local build and tests. Do not wait for Codex/Sites tools to implement product features. Preserve the documented Workers/D1 compatibility and production fail-closed authentication boundaries. Codex later performs platform registration, hosted configuration, real ChatGPT-owner verification and deployment. Never invent working platform credentials or claim local auth simulations prove hosted security.

Use models actually available in this Copilot subscription judiciously. Codex model names and tools are not Copilot requirements. No user-imposed session/token budget applies; do not add allowance checkpoints. Do not change billing or provision paid services.

Keep source modular; establish static analysis and meaningful tests early. A scaffold or mock frontend is not the deliverable. Record actual browser/network test evidence and limitations. Keep STATUS.md current; finish with HANDOFF.md as specified. Respect Git hooks and use a topic worktree if the control checkout disallows commits. Keep secrets and generated dependencies/build caches out of Git. Do not deploy or create remote repositories.
