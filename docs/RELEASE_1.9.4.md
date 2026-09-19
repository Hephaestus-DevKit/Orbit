# Orbit 1.9.4 engineering record

## Scope and publication state

This change prepares 1.9.4 from the v1.9.3 baseline (`17c57a3`), including the
runtime remediation described in [the architecture map](ARCHITECTURE.md) and
[the changelog](../CHANGELOG.md). It does not itself authorize npm publication,
a GitHub Release, or replacement of the installed CLI.

All sixteen workspace manifests use 1.9.4. The frozen dependency lockfile is
unchanged. Validation uses pnpm 10.34.5 and Node 24.19.0 on Windows x64.

## Local artifact

The current local candidate includes the current-name cleanup, pricing and
keyboard-focus fix. It supersedes the earlier artifacts recorded during this PR;
it has not been published or installed globally.

- Archive: `orbit-build-cli-1.9.4.tgz` (local ignored validation directory).
- SHA-256: `ac9293d7c5cfb45a2e774d59ab7436b12f9ad45710f1af5cb8428f3f5950bda7`.
- Packed bytes: 2,580,494; unpacked bytes: 14,343,840; entries: 35.
- Package allowlist and version checks passed. No developer absolute path was
  found in the 14,073,517-byte executable bundle. Tests, source maps and runtime
  state are not included in the archive.
- Production audit checked 54 packages and returned zero advisories on
  2026-09-19. This is a point-in-time result, not a permanent security guarantee.

The artifact checksum identifies this local build only; publication must record
the checksum of the exact CI-built artifact it publishes.

## Verification status

### Current-name cleanup and cost estimates (2026-09-19)

`pnpm verify:release` completed with exit code 0 on Windows, with temporary
Corepack available for license notices and the bundled Python runtime on PATH:

- Full Vitest and critical-coverage runs: 241 files, 1,593 passing tests and
  6 platform skips in each run.
- Critical coverage: statements/lines 85.61%, branches 77.47%, functions 91.23%.
- Playwright: all 22 tests passed, including desktop/narrow model selectors
  and stale-session recovery. The rendered screenshots were inspected.
- Dependency direction, architecture budgets, lint, formatting, all package
  builds, production types, skill validation, documentation links, CLI smoke,
  isolated archive install/uninstall, runtime budgets, production audit, notices
  and package contents passed.

After the full gate, the last browser-only stale-selection follow-up passed
`pnpm verify:webui` (153 tests in 15 files, client types, lint, format, rebuild).
The final rebuilt archive passed CLI smoke, isolated install/uninstall, package
verification and runtime budgets again: startup p90 820.9 ms against a 2,500 ms
limit. Strict doctor and dedicated-account provider acceptance remain subject to
the limitations below.

All default Flash roles, current examples, model selectors and provider requests
now use `deepseek-flash`. Retired Flash/chat/reasoner profiles are removed from
the official request path, including FIM. Migration hints and regression fixtures
deliberately retain old strings; historical changelog entries and saved sessions
are not rewritten. Explicit old role configurations must select the current ID.
Third-party gateway catalogs remain independent of the official allowlist.

Flash estimates now use the [official rates](https://api-docs.deepseek.com/quick_start/pricing/)
checked on 2026-09-19: off-peak input/output/cache-read USD 0.15/0.60/0.003 per
million tokens, doubled at peak. Flash and Pro schedules now apply peak rates
only Monday through Friday at 01:00–04:00 and 06:00–10:00 UTC. Custom schedules
without a weekday list retain their previous daily behavior. Cost figures remain
estimates, not a substitute for the provider invoice.

The pricing resolver was extracted from AgentLoop and official FIM model
validation from the OpenAI-compatible provider without raising architecture
budgets. Tests cover retired names across all three transports, FIM rejection
before network I/O, stale catalogs/overrides and UTC tariff boundaries. Browser
coverage adds desktop and narrow model-selector keyboard checks.
The menu Escape handler now respects a key event already handled by a child
control, preserving focus when the menu closes. Browser assertions wait for
font loading and menu animation before inspecting the final layout.
When a stale session selects a model absent from the authoritative catalog,
the browser now shows a disabled selection prompt rather than recreating that
retired name as a selectable option. A real-browser regression covers this path.

### Earlier Flash compatibility follow-up (2026-09-19, `8a7b485`)

The official API model list now returns `deepseek-flash`. Before this fix Orbit
rejected that ID locally. Its dedicated V4.1 profile now enables tools, thinking,
JSON, vision and Responses support, and catalog filtering retains the current ID.
Existing configurations and dated gateway IDs are not silently rewritten.
At that commit new-name pricing remained unknown unless explicitly configured;
the cleanup above now supplies separately verified current rates. Limits and capabilities
were checked against [DeepSeek's official documentation](https://api-docs.deepseek.com/).

After rebuilding, four synthetic live Flash requests completed without errors:
current-name streaming (532 ms first text), compatibility-name streaming,
`add_numbers(2,3)` tool invocation, and tool-result continuation returning `5`.
Reported usage was 444 input and 52 output tokens (496 total). The key was held
only in process memory and never added to configuration or source. This is a
small adapter smoke sample, not full AgentLoop, TUI, WebUI or Pro acceptance.
At that commit mocked tests covered both IDs across all three API transports;
current tests instead verify that retired IDs are rejected before network I/O.

### Earlier candidate validation

Local verification completed on 2026-09-18:

- Frozen install with pnpm 10.34.5; dependency direction, architecture budgets,
  lint, formatting, all workspace builds and production type checking passed.
- Full Vitest run after the CodeQL fix: 240 files passed, 1,563 tests passed
  and 6 platform skips; the complete `pnpm verify` command exited successfully.
- Critical coverage report: statements/lines 85.53%, branches 77.14%, functions
  91.23%; all exceed the checked-in thresholds.
- Browser regression: all 19 Playwright tests passed.
- CLI smoke and isolated archive install/uninstall smoke passed for 1.9.4.
- Runtime budget: 14,074,478-byte bundle, startup p90 803.9 ms (2,500 ms limit).
- Production audit, license notices, package contents and documentation links
  passed. Corepack was supplied temporarily for the notices command because it
  was absent from the host PATH; no verification threshold was relaxed.

The long release command lost its process handle before its final result could
be retrieved. Its completed reports were inspected and the browser and post-test
gates were rerun explicitly; this record does not assert one uninterrupted
`pnpm verify:release` exit. Strict doctor and credentialed checks remain limited
as described below.

## Known release limitations

PR #38 CodeQL identified polynomial backtracking in command risk regexes. The
follow-up bounds regex input to 1,024 characters and classifies larger commands
as dangerous without truncation. Ten added tests cover adversarial input, the
exact boundary and ordinary command classifications; all 40 permissions tests
passed locally. The final commit must pass CodeQL again; no alert is suppressed.

One Windows push run then timed out in the hunk-acceptance test while the same
commit's PR run passed. The test now supplies an in-memory checkpoint key,
disables unrelated retrieval and mocks Git mutation snapshots. Real file writes,
encrypted checkpoints and hunk rollback remain exercised. All 29 focused hunk,
checkpoint and real Git mutation tests passed locally, as did lint and formatting.
No timeout or CI threshold was increased; cross-platform CI must repeat this fix.

- `orbit doctor --json --strict` reports `provider.api_key.missing`: no DeepSeek
  credential is configured in this validation environment. Beyond the small
  earlier synthetic sample, no dedicated-account release probes or paid provider
  benchmarks were run; do not describe the credentialed release gate as passed.
- The Windows AppContainer helper is not installed here. Auto sandbox mode
  reports the existing host-execution fallback; required mode must fail closed.
- Production TypeScript checking passes separately from Vitest. The repository's
  existing type gate excludes test-only diagnostics; this is not a claim that
  every test source type-checks cleanly.
- Cross-platform GitHub checks must pass on the submitted commit before merge.
- Event fencing does not guard every detached internal state write; broader
  orchestration decomposition remains follow-up work.
- Further inspection found that `DeepSeekChatSerialization` replays thinking
  only on assistant tool-call turns. The [current thinking-mode contract](https://api-docs.deepseek.com/guides/thinking_mode)
  requires all preceding assistant reasoning when a request carries tools,
  including non-tool turns. This is an outstanding multi-turn compatibility
  risk that the credential-free gate does not prove safe; resolve and exercise
  it before declaring full provider release readiness.
- Windows credential encryption/decryption still use synchronous PowerShell
  children without a timeout. Add bounded execution and explicit timeout/failure
  coverage before extending credential-dependent background workflows.
- The production type gate still reports 207 excluded test-only diagnostics.
  Reduce that backlog with typed fixtures and mocks before making test-source
  type checking mandatory; do not hide it by widening the exclusion.

## Rollback

Before any installation, keep the current configuration and session data backed
up. This patch requires no persisted-data format migration, but explicit retired
model selections require the configuration change above. If a later installed build
regresses, explicitly reinstall the previously verified `@orbit-build/cli@1.9.3`
and retain user data; do not reset the working tree or delete sessions. Revert
source changes through a new reviewed commit. Never move an immutable release
tag or overwrite an npm version; publish a new fixed version if necessary.
