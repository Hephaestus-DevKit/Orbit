# Orbit 1.7.0 maturity audit

Date: 2026-08-19

## Release objective

Orbit 1.7.0 is a maturity release rather than a feature-count release. It
closes locally actionable UI, architecture, diagnostics, and verification
gaps while keeping infrastructure-owned capabilities out of the CLI's claims.

## Completed in the repository

- Short desktop, tablet, and low-height mobile layouts keep a usable
  conversation viewport when approvals and queued work are visible.
- Tasks, Activity, Changes, and Settings keep independent inspector scroll
  positions and expose restrained scroll-edge affordances.
- Inspector lifecycle, focus containment, keyboard tab behavior, and scroll
  restoration have a focused browser module instead of expanding the shared
  foundation fragment.
- The complete assembled browser controller must parse and pass an ESLint
  `no-undef` contract. This catches broken dependencies between script
  fragments in addition to the existing unit, server, CSP, and Playwright
  coverage.
- `doctor --json` preserves the effective DeepSeek transport format and dated
  Flash model profile in its validated, redacted support snapshot.
- Architecture verification now freezes reviewed growth budgets for the
  WebUI binding and inspector-style hotspots.

## Deliberate product boundaries

The following are not hidden behind placeholders or described as completed:

- A production cloud/offload service requires an operator-owned transport,
  tenant storage, identity, patch transfer, retention, incident response, and
  rollback environment. Orbit ships the local signed protocol and coordinator,
  not that external service.
- Hosted organization SSO, centralized audit retention, and key lifecycle are
  deployment services. The CLI supplies signed policy, scoped principals,
  offline JWKS validation, and local hash-chain audit foundations.
- Windows native isolation is selected only for a helper whose binary digest
  and Ed25519 contract validate against an administrator trust root. A release
  workflow build is not a substitute for publisher signing, installation, and
  host trust configuration.
- Real-provider latency and completion quality require a dedicated low-
  privilege benchmark account and a recorded region/model/sample profile.
  Credential-free CI does not fabricate those results.

## Maintenance contract

New WebUI work must preserve authenticated bootstrap, strict CSP, safe external
text rendering, SSE replay reconciliation, cancellation, focus restoration,
narrow-layout scroll containment, and the assembled-script verification gate.
Large composition modules may grow only after extracting an independent owner
or documenting reviewed evidence in the architecture budget.
