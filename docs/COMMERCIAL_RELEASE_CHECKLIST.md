# Commercial release checklist

This checklist separates automated engineering gates from product, legal, and
operational decisions that must be owned by the release team.

## Automated engineering gate

Run from a clean checkout using the supported pnpm version:

```bash
pnpm install --frozen-lockfile
pnpm verify:release
orbit doctor --json --strict
```

The gate must pass without ignored failures. It covers formatting, linting,
all workspace builds, the full Vitest suite, high-severity production dependency
auditing, CLI version consistency, executable command/config/diagnostic/init/text
REPL/LSP smoke testing, package allowlists, and artifact-size limits. GitHub
Actions repeats the contract on Node.js 20, 22, and 24 and on Windows, Linux,
and macOS.

Publishing is intentionally separate from CI. A GitHub release whose tag
exactly matches `v<package version>` triggers the protected `npm-production`
environment, rebuilds and verifies the repository, archives the tarball and its
SHA-256 checksum, and publishes that exact artifact with npm provenance. Keep
the environment approval rule and `NPM_TOKEN` restricted to release owners.

## Credentialed provider smoke tests

CI must not receive production customer credentials. Before release, use a
dedicated low-privilege test account and record redacted results for:

```bash
orbit doctor --probe --deepseek --strict
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 3 --max-tokens 256
orbit bench --model deepseek-v4-pro --thinking high --repeat 3 --max-tokens 4096
orbit bench --model deepseek-v4-flash --thinking disabled --cache-profile --repeat 3
orbit bench --model deepseek-v4-flash --thinking disabled --repeat 5 --max-first-delta-ms 2500 --max-first-text-ms 5000 --min-throughput 20 --max-error-rate 0
```

Cache hit rate and latency are observations, not release guarantees. A release
should fail only against an explicitly approved threshold and controlled test
profile. Record the runner, region, provider account tier, model ID, and sample
count alongside any approved benchmark gate so later releases remain comparable.

The protected `DeepSeek release gate` workflow automates these checks after a
dedicated low-privilege credential is configured in the `deepseek-testing`
environment. Until that environment exists and a run is recorded, the real
provider gate is not considered satisfied even when the credential-free CI is
green.

## Manual product smoke tests

- Install the packed CLI into a clean user profile and verify `orbit --version`,
  `orbit login`, TUI startup, non-interactive `orbit exec`, and clean Ctrl+C.
- Open the Web UI, verify bootstrap authentication, chat, cancellation,
  settings, reconnect, narrow viewport layout, and keyboard-only operation.
- Verify the VS Code autocomplete extension against `orbit lsp`, including
  editor shutdown and rapid completion cancellation.
- Verify checkpoint creation, rollback, rewind after restart, protected-path
  approval, Git-unavailable fallback, and non-TTY text fallback.
- Confirm no test key, local path, `.orbit` state, source map, or private fixture
  appears in the npm package or support snapshot.

## Required owner decisions before public sale

- Apache License 2.0 and third-party notices are published. Confirm separately
  whether paid services require an EULA or additional commercial terms.
- Decide whether only `@orbit-build/cli` is distributed or the current internal
  workspace packages become supported public SDKs.
- Publish privacy terms. Orbit currently has no opt-in telemetry pipeline; any
  future telemetry requires explicit consent, schema review, retention limits,
  and a documented disable path.
- Define supported operating systems, Node.js lifecycle, provider compatibility,
  update channels, deprecation windows, and customer support/SLA boundaries.
- Define package signing/provenance, release approvers, npm organization access,
  recovery keys, and an incident response owner.
- Review product name, trademarks, billing claims, provider pricing, and all
  performance claims with the appropriate legal and product owners.

## Release record

For every release, archive the commit, changelog entry, CI run, packed artifact
hash, dependency audit result, redacted provider smoke results, approver, and
rollback instructions. Never archive credentials or raw customer workspaces.
