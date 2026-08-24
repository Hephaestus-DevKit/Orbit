# Orbit 1.9.0 harness maturity record

Orbit 1.9.0 is a focused interoperability and recovery release. A review of
the local Helix, Nexus, and Syntheon workbenches was used to close two concrete
Orbit gaps without importing their Electron-only or cloud-specific surfaces.

## Adopted ideas

- **Helix instruction compatibility:** Orbit now accepts the dedicated project
  instruction conventions used by adjacent agent harnesses, with an explicit
  order, source labels, a one-megabyte combined bound, regular-file checks, and
  README-only fallback behavior.
- **Nexus recovery receipts:** durable daemon tasks now record a stable failure
  category, whether explicit resume is reasonable, and a bounded next action.
  The receipt survives daemon restarts and is cleared when a new attempt is
  queued.
- **Syntheon-style surface discipline:** the human daemon view is intentionally
  a small presentation layer over the typed protocol; JSON output is unchanged
  for scripts and remote integrations.

## Explicitly not imported

- Electron packaging, renderer state stores, and OS-specific installers do not
  belong in Orbit's local Node/WebUI runtime.
- Nexus's global parallel turn UI is not enabled: Orbit's shared terminal/WebUI
  ownership remains serialized while the existing bounded subagent scheduler
  handles safe parallel work.
- Remote/cloud queues, real provider SLA claims, and external signing services
  remain outside a repository-only release gate.

## Verification invariants

- Optional instruction files are never followed through a symlink and cannot
  consume more than the combined context bound.
- Old daemon task records without the new optional fields parse unchanged.
- Every terminal daemon path emits one deterministic recovery category; explicit
  cancellation is not presented as an automatic retry.
- Machine-readable daemon JSON remains schema-compatible; only non-JSON CLI
  presentation gains recovery detail.
