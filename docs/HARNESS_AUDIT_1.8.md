# Orbit 1.8.0 harness maturity record

Orbit 1.8.0 is a reliability and evidence release. It strengthens existing
Agent, provider, UI, persistence, evaluation, and Skill foundations instead of
adding an unrelated product surface.

## Release invariants

- Every external persistence and report boundary remains bounded and
  schema-validated.
- Future durable data fails closed and is never overwritten by an older Orbit.
- Cancellation produces one terminal outcome and late provider tool calls
  cannot mutate the workspace.
- Acceptance comparisons require the same suite version, fixture contents, and
  task set; report totals must agree with task evidence.
- Multi-file project restore is staged on the target filesystem and rolls back
  earlier writes when a later commit fails.
- Browser changes retain authentication, same-origin CSP, SSE replay,
  cancellation, stale-instance isolation, approval ownership, and focus return.
- CUMCM delivery continues to require runnable responsibility modules,
  evidence-linked Chinese results, descriptive 300 dpi PNG figures, compact
  `happy/` output, and successful strict finalization.

## Architecture ownership

The release introduces small dedicated owners rather than expanding existing
state-machine hotspots:

- `packages/shared/src/migrations.ts` owns contiguous durable-data migrations.
- `packages/session/src/SessionSnapshot.ts` owns bounded snapshot loading and
  future-version refusal.
- `packages/core/src/evaluation/AcceptanceComparison.ts` owns version-to-version
  acceptance evidence comparison.
- Typed WebUI history and inspector factories own their browser lifecycle and
  expose only the functions required by the assembled controller.

The architecture gate still rejects unreviewed package dependency directions
and growth beyond the recorded AgentLoop, TUI, command router, MCP, provider,
WebUI, indexing, session, and daemon hotspot budgets.

## Verification contract

The release gate covers formatting, lint, production source type checking,
workspace builds, the complete Vitest suite, expanded critical coverage,
real-browser WebUI E2E, bundled Skill validation, complete CUMCM PDF delivery,
CLI and installed-package smoke tests, runtime budgets, production dependency
audit, third-party notices, documentation links, package allowlists, SBOM, and
packed-artifact inspection.

Credentialed provider benchmarks remain a protected release-owner gate. They
must use a dedicated low-privilege account and record runner, region, model ID,
account tier, sample count, and redacted measurements; repository verification
does not pretend to prove an external provider SLA.

## Remaining long-horizon work

Orbit retains explicit longer-term targets: more protocol fuzzing, disk-full
and process-crash injection, long-duration memory/soak baselines, broader
browser visual-diff automation, and responsibility-level extraction from the
largest state machines. These are continuing hardening tracks, not missing
release safety claims for 1.8.0.
