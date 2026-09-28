# Workflow and Skill execution contract

## Scope

Skills provide reusable instructions. Commands provide explicit entry points.
Structured workflows add sequential stages with durable outcomes and gates;
they do not replace AgentLoop permissions, verification, sessions, or rollback.
Extensions remain the distribution unit. Existing prompt commands remain valid.

## Acceptance checklist

- Explain positive and negative Skill selection without logging raw user queries.
- Respect explicit opt-outs and ignore fenced examples during automatic selection.
- Keep exported drafts out of model context until author review; retain legacy bundles.
- Validate stage definitions at load time and check dependencies before every stage.
- Require real AgentLoop outcomes and declared artifact/verification evidence.
- Persist running state before execution and completion only after gates pass.
- Resume only the first unfinished stage; verify definition and completed artifacts.
- Serialize workspace workflow execution, preserve cancellation, never replay shell logs.
- Provide run/status/resume/cancel controls through the shared terminal/WebUI router.
- Test failure, interruption, corruption, traversal, changed definitions and stale artifacts.

## Boundaries

The first structured format is sequential, not a DAG or distributed scheduler.
There is no automatic retry of a failed stage: the user explicitly resumes after
inspecting its error. AgentLoop retains its existing bounded repair policy.
Verification gates use the run receipt, not a model's claim. Artifact gates check
regular nonempty files and record SHA-256 hashes; they do not certify semantic
correctness. A resumed workflow requires the original session and unchanged
definition and completed artifact hashes. Model actions keep normal approvals.

Draft approval is author-maintained metadata, not certification. Skill full-read
requirements remain prompt instructions rather than a claim of enforced model
comprehension. Trigger rules are conservative lexical heuristics, not semantic
understanding. Source, command, and Skill files are trusted workspace inputs;
do not install unreviewed third-party procedures.

## State and recovery

Each run has a unique ID, original session, definition hash, redacted input,
ordered stage states, artifact hashes, and final status. State writes are atomic.
Only one workflow executes in a workspace at a time. A live owner cannot be
stolen. A crashed owner is recovered only during an explicit resume; a previously
running stage becomes interrupted and is rerun, never presumed successful.
Completed stages are not repeated. Cancellation stops the active AgentLoop,
persists an interrupted state, and does not undo prior successful stages.

## Local validation (2026-09-19)

- Full Vitest suite: 246 files passed; 1,674 tests passed, 6 skipped.
- Playwright: 23 passed, including workflow creation, invalid JSON feedback,
  persisted stage definitions, draft activation gates and desktop/narrow layouts.
- Workspace build, lint, formatting, production TypeScript, architecture,
  dependency declarations, documentation links and CLI smoke checks passed.
- Bundled Skill deep validation: no diagnostics. CUMCM quick evaluation:
  24 tests ran, 1 skipped.
- Production TypeScript has no errors. The repository retains 207 pre-existing
  test-only type diagnostics excluded by its source gate; this is not a claim
  that the entire test tree is type-clean.

Validation used pnpm 10.34.5 and the bundled Python runtime on Windows. No live
paid-model request, GitHub push, release, or global installation was performed.
