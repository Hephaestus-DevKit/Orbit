# Orbit documentation

Orbit keeps the product overview short and reveals detail by audience and task.

## Use Orbit

- [Repository overview](../README.md): product positioning, three-minute start,
  capabilities, and the shortest route to each document.
- [User guide](USER_GUIDE.md): projects and chats, providers, models, Web UI,
  slash commands, context, safety, automation, cleanup, and troubleshooting.
- [Security policy](../SECURITY.md): supported versions and private
  vulnerability reporting.
- [Changelog](../CHANGELOG.md): user-visible changes by release.
- [Extension manifest v1](EXTENSIONS.md): validated metadata, permissions,
  compatibility, contributions, and current loading limits.

For the authoritative command surface, run `orbit --help` or
`orbit <command> --help`; this prevents static reference pages from drifting
from the installed version.

## Maintain Orbit

- [Maintainer guide](MAINTAINER_GUIDE.md): ownership, change locations, safety
  invariants, verification, release flow, and troubleshooting.
- [Architecture map](ARCHITECTURE.md): dependency direction, turn lifecycle,
  trust boundaries, persistence, retrieval, and review neighborhoods.
- [Commercial release checklist](COMMERCIAL_RELEASE_CHECKLIST.md): automated
  gates, platform/provider smoke tests, and decisions required before sale.
- [Commercial decisions](COMMERCIAL_DECISIONS.md): legal, privacy, distribution,
  support, incident-response, and branding owner decisions.
- [CLI competitive roadmap](CLI_COMPETITIVE_ROADMAP.md): longer-term product and
  architecture direction, not a promise of implemented behavior.
- [0.9 harness maturity audit](HARNESS_AUDIT_0.9.md): implemented evidence,
  deliberate safety boundaries, and post-0.9 priorities.
- [Third-party notices](../THIRD_PARTY_NOTICES.md): generated production
  dependency license inventory.
- [Agent guidelines](../AGENTS.md): required code, UX, security, and test
  standards for automated changes.

## Implementation maps

These notes live beside the code they describe:

- [Runtime command handlers](../packages/cli/src/runtime/commands/README.md)
- [Full-screen TUI](../packages/cli/src/tui/README.md)
- [Web UI runtime](../packages/cli/src/runtime/webui/README.md)
- [Agent runtime](../packages/core/src/agent/README.md)
