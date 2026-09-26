<!-- hybrid-agent-framework:start -->
## Hybrid Agent Framework

- For feature, fix, refactor, or implementation requests, invoke `$hybrid` first.
- Tier 0/1 work should load only the relevant files; do not read the whole planning tree for a tiny change.
- For Tier 2/3 work or resume/recovery, read `.planning/PROJECT.md`, `.planning/STATE.md`, then the active SPEC/PLAN.
- Use `.planning/` as canonical state; `.ai/wiki/` is derived.
- Scout the repository before asking user questions that code can answer.
- Keep dispatch flat: only the lead spawns sibling Hybrid roles; workers return results and never recursively delegate.
- Serialize same-file writers and respect task dependencies; when scheduler isolation selects worktree mode, the lead owns create → isolated cwd → patch handoff → fail-closed integration → verification → cleanup via `.hybrid/core/worktree/index.mjs`.
- Route work through the Luna effort ladder first; use Sol only after Luna max is insufficient or the task is exceptionally difficult/critical according to `.hybrid/core/routing/model-routing.json`.
- Every Hybrid-controlled inference must use the explicit allowlisted model and reasoning effort resolved by `.hybrid/core/routing/model-routing.json`; session/default model inheritance is prohibited. Pass both values explicitly on every worker spawn and record bounded `requestedModel` / `requestedReasoningEffort` metadata in linked provenance. If the routed override is unavailable or rejected, fail closed without retrying model-less or substituting another model.
- Separate implementation from final testing/review/verification. Normal Tier 0 task mutation is owned by one Implementer followed by lightweight verification; the Lead MUST NOT substitute for that Implementer. Before any Implementer-owned mutation, run the provenance-wired preparation path and spawn the required Implementer. If the required worker cannot be spawned, fail closed without mutating its files.
- Use `.hybrid/core/orchestrator/index.mjs` `prepareExecutionWithProvenance()` for normal installed execution preparation. Finalize task normalization/classification first (pure `prepareExecution()` may be used for zero-I/O inspection), then call the wired wrapper exactly once for the selected execution revision. Do not persist trial preparations or manually replay `decisionTrace`.
- Preserve the Tier 0 fast path: Implementer → deterministic lightweight verification → Lead-owned completion provenance/audit, with no routine QA fan-out. When the existing tier/risk path requires generic quality closure, use `runQualityClosure()` from `.hybrid/core/orchestrator/index.mjs`; its default path owns Lead decision/event persistence, repair/proof reassessment, and completion gating without adding a new agent role.
- Keep Decision Provenance passive and structured: the lead alone writes central orchestration decisions; workers return bounded metadata and may write only their own actor artifact through the worker-scoped API.
- Central action-bearing events must use the Lead-owned orchestration event writer (or Lead provenance session). When an action belongs to an existing decision, retain/load that decision object and use `writeActionForDecision(decision, event)` rather than manually transcribing its decision ID or routed model metadata. Public low-level `appendRuntimeEvent()` is passive-only and cannot write decision/action ownership records.
- Each implementation worker writes one bounded completion self-report only to its own actor artifact; worker self-reports remain `reported`. Use an observed native worker ID when available, otherwise explicitly distinguish a framework-logical worker ID.
- Link actual orchestration actions to their decisions when available. Runtime events record what happened, Decision Provenance records the selected control-flow action, actor artifacts record bounded worker activity, and deterministic audit checks their agreement.
- Before provenance-backed completion, the Lead runs installed `auditDecisionTrace()` over the run decisions/events/actor artifacts and persists the derived `audit.json` through `writeAuditArtifact()` or the Lead provenance session.
- Never record chain-of-thought, hidden reasoning, scratchpads, prompts, conversations, source text, whole diffs, or raw secret-bearing output in runtime events, decisions, actor artifacts, or audit reports.
- Run security review only for trust-boundary-sensitive changes.
- Stop targeted fix loops after three iterations and preserve failure evidence.
- Hybrid deterministic helpers are available with `node .hybrid/bin/hybrid.mjs help`.
<!-- hybrid-agent-framework:end -->

## Project workflow preference

- Use the installed Hybrid Agent Framework for project tasks by default, including QA and maintenance. Skip it only when the user explicitly opts out for a task.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
