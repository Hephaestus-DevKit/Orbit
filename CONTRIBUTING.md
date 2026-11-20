# Contributing to Orbit

## Development setup

Use Node.js 24 or newer and the pnpm version declared in `package.json`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Run `pnpm exec playwright install webkit` and `pnpm test:webui:e2e`
for the full Web UI suite. To test another installed channel, set `ORBIT_E2E_BROWSER_CHANNEL` explicitly. On macOS with Allow Remote Automation enabled in Safari, run
`pnpm test:webui:safari` for native Safari screenshots and keyboard input against a local fixture.
CI and npm release verification run both browser suites on macOS. The release also verifies the package and CLI on Linux before publishing.
The Safari driver does not enforce the controlled browser's network boundary, so
this test does not enable Safari for live pages.

Read `AGENTS.md` before changing the runtime. The file documents Orbit's type,
security, UX, workspace-isolation, and verification requirements. The
maintainer map in `docs/MAINTAINER_GUIDE.md` identifies the main ownership
boundaries and focused test commands.

## Change requirements

- Add or update Vitest coverage for new behavior and failure paths.
- Validate external input with Zod and preserve workspace path boundaries.
- Never commit credentials, real provider responses containing private data,
  generated `.orbit` state, or customer diagnostic bundles.
- Keep constructors side-effect free and route long-running status through the
  centralized event system.
- Run `pnpm verify` before submitting a change. Release-facing changes must also
  pass `pnpm verify:release`.

Security reports must follow `SECURITY.md`, not the public issue tracker.

## Contribution licensing

Orbit is licensed under the Apache License 2.0. Unless you explicitly state
otherwise, contributions intentionally submitted for inclusion in Orbit are
provided under the same license, as described in Section 5 of [LICENSE](LICENSE).
