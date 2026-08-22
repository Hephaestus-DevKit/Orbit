# Orbit acceptance suites

Two layers verify agent behavior:

- **Offline harness regressions** (no API key, run in CI):
  `packages/core/src/agent/AgentLoopWeakModel.test.ts` drives the real
  `AgentLoop` with scripted providers that reproduce weak-model failure
  modes — text-form tool calls, repeated identical calls, provider
  overload — and asserts the harness still completes the task.
- **Live acceptance suites** (this directory): `orbit eval` against real
  providers.

`orbit eval` measures task completion from repository changes and verification
commands, not from the model claiming that it succeeded. Every task runs in a
disposable Git worktree and is discarded after its redacted trace and report
are copied to `.orbit/evaluations/`.

Review every suite before allowing its verification commands:

```powershell
orbit eval evals/deepseek-v4.yaml --provider deepseek --model deepseek-v4-pro --allow-commands
```

Store one reviewed report as a same-suite baseline, then make later runs fail
closed on task, reliability, verification, or latency regressions:

```powershell
orbit eval evals/deepseek-v4.yaml --provider deepseek --model deepseek-v4-pro --allow-commands --baseline .orbit/evaluations/<baseline-run>.json --max-duration-regression-percent 25
```

Baseline comparison requires the same suite version, fixture hash, and task set.
Declare bounded workspace-relative roots in `metadata.fixturePaths`; Orbit
hashes every regular file before the run and rejects links, generated state,
credential files, oversized trees, or a stale explicitly declared hash.
Reports are workspace-bounded, size-limited, non-symlink files; incompatible or
internally inconsistent evidence is rejected rather than compared.

Use a dedicated low-privilege provider account. Do not put credentials in a
suite. Provider and model overrides can be supplied on the command line or per
task. The checked-in public suite covers JavaScript and Python repair,
multi-file unit correctness, immutable migration, path-boundary security, and
abort-safe lifecycle behavior. Release owners should still add representative
private repositories without committing customer code.

The manual `DeepSeek release gate` workflow repeats bounded Flash and Pro
protocol/latency checks from a protected `deepseek-testing` environment. Add
only a dedicated `DEEPSEEK_API_KEY` or `TOKENDANCE_API_KEY`; never copy a
personal or production customer credential into repository secrets. Enable the
extended input only when the extra acceptance-suite cost is intended.

Tasks may optionally declare `limits` for `maxDurationMs`, `maxInputTokens`,
`maxOutputTokens`, `maxCostUsd`, and `minCacheHitRate`. Orbit reads the measured
values from the redacted session trace; missing usage data fails a task that
declares usage limits. Calibrate limits from repeated runs on one controlled
runner and provider tier instead of copying arbitrary thresholds between
machines or accounts.
