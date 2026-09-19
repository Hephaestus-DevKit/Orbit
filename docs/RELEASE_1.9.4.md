# Orbit 1.9.4 engineering record

## Scope and publication state

This change prepares 1.9.4 from the v1.9.3 baseline (`17c57a3`), including the
runtime remediation described in [the architecture map](ARCHITECTURE.md) and
[the changelog](../CHANGELOG.md). It does not itself authorize npm publication,
a GitHub Release, or replacement of the installed CLI.

All sixteen workspace manifests use 1.9.4. The frozen dependency lockfile is
unchanged. Validation uses pnpm 10.34.5 and Node 24.19.0 on Windows x64.

## Local artifact

The artifact below predates the current-name DeepSeek Flash compatibility fix.
It must be rebuilt and reverified before publication of the final candidate.

This artifact includes the PR CodeQL follow-up fix below. The later hunk-test
isolation change does not alter packaged production code.

- Archive: `orbit-build-cli-1.9.4.tgz` (local ignored validation directory).
- SHA-256: `c046e38e4c6024971d176b654358ab9590ad192e2cbf25bc765f03c7fd7b3d16`.
- Packed bytes: 2,580,516; unpacked bytes: 14,344,798; entries: 35.
- Package allowlist and version checks passed. No developer absolute path was
  found in the executable bundle. Tests, source maps and runtime state are not
  included in the archive.
- Production audit checked 54 packages and returned zero advisories on
  2026-09-18. This is a point-in-time result, not a permanent security guarantee.

The artifact checksum identifies this local build only; publication must record
the checksum of the exact CI-built artifact it publishes.

## Verification status

### Current Flash compatibility follow-up (2026-09-19)

The official API model list now returns `deepseek-flash`. Before this fix Orbit
rejected that ID locally. Its dedicated V4.1 profile now enables tools, thinking,
JSON, vision and Responses support, and catalog filtering retains the current ID.
Existing configurations and dated gateway IDs are not silently rewritten.
New-name pricing remains unknown unless explicitly configured; the old Flash
price table is not assumed to describe V4.1. Published limits and capabilities
were checked against [DeepSeek's official documentation](https://api-docs.deepseek.com/).

After rebuilding, four synthetic live Flash requests completed without errors:
current-name streaming (532 ms first text), compatibility-name streaming,
`add_numbers(2,3)` tool invocation, and tool-result continuation returning `5`.
Reported usage was 444 input and 52 output tokens (496 total). The key was held
only in process memory and never added to configuration or source. This is a
small adapter smoke sample, not full AgentLoop, TUI, WebUI or Pro acceptance.
Mocked tests also cover both IDs across all three supported API transports.

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
  credential is configured in this validation environment. No credentialed model
  probes or paid provider benchmarks were run; do not describe these as passed.
- The Windows AppContainer helper is not installed here. Auto sandbox mode
  reports the existing host-execution fallback; required mode must fail closed.
- Production TypeScript checking passes separately from Vitest. The repository's
  existing type gate excludes test-only diagnostics; this is not a claim that
  every test source type-checks cleanly.
- Cross-platform GitHub checks must pass on the submitted commit before merge.
- Event fencing does not guard every detached internal state write; broader
  orchestration decomposition remains follow-up work.

## Rollback

Before any installation, keep the current configuration and session data backed
up. This patch requires no persisted-data migration. If a later installed build
regresses, explicitly reinstall the previously verified `@orbit-build/cli@1.9.3`
and retain user data; do not reset the working tree or delete sessions. Revert
source changes through a new reviewed commit. Never move an immutable release
tag or overwrite an npm version; publish a new fixed version if necessary.
