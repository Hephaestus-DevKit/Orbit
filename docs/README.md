# Orbit documentation

Orbit keeps the product overview short and reveals detail by audience and task.

## Use Orbit

- [Repository overview](../README.md): product positioning, three-minute start,
  capabilities, and the shortest route to each document.
- [User guide](USER_GUIDE.md): projects and chats, providers, models, Web UI,
  slash commands, context, safety, automation, cleanup, and troubleshooting.
- [Security policy](../SECURITY.md): supported versions and private
  vulnerability reporting.
- [1.0.0 harness audit](HARNESS_AUDIT_1.0.md): completed foundations,
  verification evidence, and deliberately documented boundaries.
- [1.5.0 harness audit](HARNESS_AUDIT_1.5.md): durable MCP task controls,
  inherited Agent Profiles, model-effort adaptation, Mission Control states,
  and the remaining world-class product gates.
- [1.6.0 harness audit](HARNESS_AUDIT_1.6.md): process sandbox boundaries,
  ACP bridge, MCP host interactions, review findings, and extension trust roots.
- [1.7.0 maturity audit](HARNESS_AUDIT_1.7.md): WebUI architecture and compact
  layout hardening, executable quality gates, support-snapshot fidelity, and
  the remaining deployment-owned boundaries.
- [1.8.0 harness maturity record](HARNESS_AUDIT_1.8.md): migration, acceptance,
  transactional recovery, typed WebUI, Skill, and release evidence.
- [0.9.2 competitive harness audit](HARNESS_AUDIT_0.9.2.md): Codex, Claude
  Code, and Zed comparison matrix, acceptance suite, and release-channel
  decision record.
- [Changelog](../CHANGELOG.md): user-visible changes by release.
- [Extension manifest v1](EXTENSIONS.md): validated metadata, permissions,
  compatibility, contributions, and current loading limits.
- [Agent Profiles](AGENT_PROFILES.md): schema, discovery precedence, safety
  rules, and one-shot/multi-agent usage.

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
