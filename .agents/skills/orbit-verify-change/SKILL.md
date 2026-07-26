---
name: orbit-verify-change
description: Validate Orbit source changes with risk-based tests, lint, formatting, package builds, security invariants, and final diff inspection. Use when implementing or fixing Orbit code, reviewing an uncommitted change, choosing verification commands, or deciding whether a change is ready to hand off. 适用于修改、修复、验证或审查 Orbit 源码。
---

# Verify an Orbit change

Treat verification as part of the implementation, not a final formality.

## Workflow

1. Run `git status --short` and preserve unrelated user changes.
2. Identify the owning package and every boundary affected by the change.
3. Add or update colocated Vitest coverage for new behavior and failure paths.
4. Run the smallest relevant feedback loop first.
5. Expand to lint, format checking, affected package builds, and the full test suite when the change is stable.
6. Run `git diff --check` and inspect the final diff for generated files, credentials, debug output, and accidental scope growth.
7. Report exact commands and outcomes. Never describe an unrun check as passing.

Read [references/verification-matrix.md](references/verification-matrix.md) to select commands and required risk checks.

## Non-negotiable invariants

- Keep external inputs schema-validated and credentials redacted.
- Verify every filesystem path remains inside the authorized workspace.
- Preserve approval, cancellation, fallback, and cleanup behavior across CLI, TUI, and WebUI entry points.
- Keep constructors free of I/O and asynchronous side effects.
- Emit long-running state through the event bus instead of domain-layer console output.
- Do not edit `dist`, `node_modules`, or `.orbit` runtime state as source.

## Failure handling

Fix the earliest root failure, rerun its focused check, then rerun the wider gate. If an environment limitation prevents a check, identify the exact limitation and provide the strongest completed substitute.
