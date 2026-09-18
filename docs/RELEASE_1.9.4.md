# Orbit 1.9.4 engineering record

## Scope and publication state

This change prepares 1.9.4 from the v1.9.3 baseline (`17c57a3`), including the
runtime remediation described in [the architecture map](ARCHITECTURE.md) and
[the changelog](../CHANGELOG.md). It does not itself authorize npm publication,
a GitHub Release, or replacement of the installed CLI.

All sixteen workspace manifests use 1.9.4. The frozen dependency lockfile is
unchanged. Validation uses pnpm 10.34.5 and Node 24.19.0 on Windows x64.

## Local artifact

- Archive: `orbit-build-cli-1.9.4.tgz` (local ignored validation directory).
- SHA-256: `75ab5522a8b3a17549c3ebb6896034956e612e18e35c01c07b2cd3c7a2bdb979`.
- Packed bytes: 2,580,505; unpacked bytes: 14,344,733; entries: 35.
- Package allowlist and version checks passed. No developer absolute path was
  found in the executable bundle. Tests, source maps and runtime state are not
  included in the archive.
- Production audit checked 54 packages and returned zero advisories on
  2026-09-18. This is a point-in-time result, not a permanent security guarantee.

The artifact checksum identifies this local build only; publication must record
the checksum of the exact CI-built artifact it publishes.

## Verification status

Local verification completed on 2026-09-18:

- Frozen install with pnpm 10.34.5; dependency direction, architecture budgets,
  lint, formatting, all workspace builds and production type checking passed.
- Full Vitest run: 239 files passed, 1,553 tests passed and 6 platform skips.
- Critical coverage report: statements/lines 85.53%, branches 77.14%, functions
  91.23%; all exceed the checked-in thresholds.
- Browser regression: all 19 Playwright tests passed.
- CLI smoke and isolated archive install/uninstall smoke passed for 1.9.4.
- Runtime budget: 14,074,413-byte bundle, startup p90 966.3 ms (2,500 ms limit).
- Production audit, license notices, package contents and documentation links
  passed. Corepack was supplied temporarily for the notices command because it
  was absent from the host PATH; no verification threshold was relaxed.

The long release command lost its process handle before its final result could
be retrieved. Its completed reports were inspected and the browser and post-test
gates were rerun explicitly; this record does not assert one uninterrupted
`pnpm verify:release` exit. Strict doctor and credentialed checks remain limited
as described below.

## Known release limitations

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
