# Orbit 1.9.1 harness maturity record

Orbit 1.9.1 is a compatibility patch on top of the 1.9.0 recovery release.
It closes the remaining workspace-instruction gap identified during the Helix,
Nexus, and Syntheon review.

## Scoped instruction contract

- Root instruction files are loaded first in the documented order.
- For explicitly relevant files only, Orbit walks existing ancestor directories
  and loads module-level `ORBIT.md`, `AGENTS.md`, `CLAUDE.md`, and compatible
  instruction names after the root rules.
- Every source is labeled in the model context, deduplicated, bounded by the
  same one-megabyte total budget, and read through the regular-file/symlink
  safety boundary.
- Invalid or outside-workspace relevant paths are ignored rather than allowed
  to alter instruction discovery.

This is intentionally scoped discovery, not a workspace-wide recursive scan:
it improves monorepo correctness without adding startup I/O or unrelated prompt
content.
