<!-- hybrid-agent-framework:start -->
## Hybrid Agent Framework

- For feature, fix, refactor, or implementation requests, invoke `$hybrid` first.
- Tier 0/1 work should load only the relevant files; do not read the whole planning tree for a tiny change.
- For Tier 2/3 work or resume/recovery, read `.planning/PROJECT.md`, `.planning/STATE.md`, then the active SPEC/PLAN.
- Use `.planning/` as canonical state; `.ai/wiki/` is derived.
- Scout the repository before asking user questions that code can answer.
- Keep dispatch flat: only the lead spawns sibling Hybrid roles; workers return results and never recursively delegate.
- Serialize same-file writers and respect task dependencies.
- Route ordinary worker stages to the Luna tier; escalate only high-judgment/risk stages to Sol according to `.hybrid/core/routing/model-routing.json`.
- If an explicit routed model is unavailable/rejected, retry that spawn without model/effort override and record session-inheritance fallback.
- Separate implementation from final testing/review/verification.
- Run security review only for trust-boundary-sensitive changes.
- Stop targeted fix loops after three iterations and preserve failure evidence.
- Hybrid deterministic helpers are available with `node .hybrid/bin/hybrid.mjs help`.
<!-- hybrid-agent-framework:end -->
