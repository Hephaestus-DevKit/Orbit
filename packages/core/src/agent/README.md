# Agent runtime map

The agent directory owns model orchestration and turn state. Keep provider
protocol details in `model-providers`, tool implementations in `tools`, and UI
state in `cli`/`tui`; this folder coordinates those capabilities.

## Main flow

- `AgentLoop.ts` owns one persisted chat's execution lifecycle, approvals,
  checkpoints, verification, context compaction, and public session controls.
- `AgentSessionBootstrap.ts` performs the explicit I/O bootstrap for new and
  resumed sessions. Orchestrated children keep Sessions in the main project's
  `.orbit/agent-sessions` even when tools execute in a temporary worktree.
  `AgentLoop` constructors remain assignment-only.
- `Orchestrator.ts` coordinates higher-level task execution: one isolated
  writer followed by a bounded reusable team of read-only reviewers.
- `AgentTeamPresets.ts` resolves the provider-neutral fast, balanced, and
  thorough reviewer recipes from validated configuration.
- `AgentTaskScheduler.ts` runs one dependency DAG with bounded concurrency,
  normalized scope ownership, and graph-wide cancellation after timeout or
  failure. Scheduler instances are deliberately single-use.
- `AgentOwnership.ts` validates logical write scopes and owns all overlap
  semantics; do not reproduce path comparisons in schedulers or orchestrators.
- `Planner.ts` and `StepRunner.ts` turn a task into recoverable execution steps.
- `MessageBuilder.ts` constructs stable model messages and volatile project
  context without exposing internal messages to normal chat history.
- `ContextWindowManager.ts` calculates model-aware budgets and compacts history.
- `ModelRouter.ts` selects an appropriate model while preserving the active
  chat and provider state.
- `AgentInteraction.ts` defines the UI-agnostic prompt, progress, approval, and
  rendering ports consumed by the loop. The core package does not import the
  concrete TUI; CLI/TUI or WebUI adapters are supplied by the composition root.
- `AgentInputQueueController.ts` owns atomic queue mutation, ordering, and the
  content-free lifecycle event protocol. `AgentLoop` retains the safety decision
  for when steering may enter conversation history.
- `PromptCacheSlab.ts` keeps the reusable DeepSeek prompt prefix stable and
  records measured cache telemetry.

## Model and tool boundaries

- `@orbit-build/model-providers` owns model-family adaptation. Use
  `resolveModelThinkingPolicy()` and `resolveModelCanonicalName()` for thinking
  budgets and identity; do not key DeepSeek behavior off a provider hostname.
- `@orbit-build/tools` keeps the built-in tool list in `defaultRegistry.ts`.
  Prefer `createDefaultToolRegistry()` when a caller needs an isolated registry;
  the exported process-wide registry is retained only for compatibility.

## Focused support modules

- `AgentToolProtocol.ts`: native/XML tool instructions and XML fallback parsing.
- `AgentTextTransforms.ts`: SEARCH/replace parsing, path extraction, and bounded
  verification-log cleanup.
- `AgentAudit.ts`: file-mutation classification, hashes, and bounded audit diffs.
- `LocalPackageBinary.ts`: safe resolution and execution of workspace-local
  formatter, linter, and test binaries.
- `McpRuntimeManager.ts`: owns MCP process lifetimes and removes temporary
  dynamic tools when a run ends or restarts.

These helpers are deliberately stateless. Add pure parsing and formatting logic
there instead of extending `AgentLoop.ts`. Keep filesystem, approval, session,
and model lifecycle decisions in the loop so their ordering remains explicit.
Do not split the loop solely because it is long: split only when a new module
owns an independent boundary and can be tested without reproducing the loop's
ordering state.

## Verification

```powershell
pnpm exec vitest run packages/core/src/agent
pnpm --filter "@orbit-build/core..." build
pnpm verify
```

New behavior needs a colocated `*.test.ts`. Preserve `.js` suffixes on internal
ESM imports and avoid exporting support helpers unless another package has a
real use for them.
