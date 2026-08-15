# Security threat model

This document defines the security boundary Orbit intends to maintain. It is a
release-engineering artifact, not a claim that arbitrary model output is safe.

## Protected assets and trust boundaries

- **Workspace and Git state:** user source, uncommitted changes, history, and
  files outside the selected project must not be silently damaged or exposed.
- **Credentials:** provider and search keys must remain in the credential store
  and must not cross logs, traces, Web UI responses, error messages, or packed
  artifacts in plaintext.
- **Conversation state:** prompts, model responses, tool summaries, goals, and
  plans are private local data unless sent to a configured provider.
- **Local execution:** shell commands, hooks, MCP servers, and model-proposed
  tools cross from untrusted instructions into the host process.
- **Web UI:** the loopback browser is a separate process. Every API and event
  request remains authenticated; loopback reachability alone is not trust.
- **External providers:** model, search, and compatible gateway operators are
  outside Orbit's trust boundary and receive only the context required by the
  selected operation.

## Material threats and current controls

| Threat                                                                 | Required control                                                                                                                                                                                  | Regression evidence                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Workspace traversal or protected-file overwrite                        | Resolve paths inside the workspace, reject unsafe paths, and require the configured approval policy for sensitive changes.                                                                        | Tool, policy, and Web UI security tests.                     |
| Prompt injection causing command execution                             | Treat model output as untrusted tool proposals; enforce tool schemas, risk classification, permissions, and approval before execution.                                                            | Agent loop, tool registry, and approval-broker tests.        |
| Web fetch reaching private or reserved infrastructure                  | Reject literal and DNS-resolved non-public addresses; when a local proxy returns RFC 2544 synthetic addresses, independently verify the hostname through bounded public DNS-over-HTTPS.           | Public URL, redirect, DNS, and proxy-resolution tests.       |
| Malformed or misleading remote MCP tool schemas                        | Bound and compile remote JSON Schemas, then validate every MCP invocation at runtime before approval or transport.                                                                                | MCP schema compilation and input-validation tests.           |
| Secret disclosure through UI, trace, event, or failure output          | Store keys outside config, allowlist browser event fields, summarize tool payloads, and redact recognized credential patterns at every output boundary.                                           | Credential, trace, redaction, and Web UI security tests.     |
| Local Web UI hijack or cross-origin request                            | Bind locally, use an unpredictable bootstrap capability, establish an HttpOnly SameSite cookie, validate origin and content type, use constant-time token comparison, and ship a restrictive CSP. | Web UI server and security tests.                            |
| Corrupt or partially written session/project state                     | Validate persisted input with Zod, write atomically, keep a recoverable backup/journal, and bound data returned to UI surfaces.                                                                   | Session store, journal, and project registry recovery tests. |
| Agent edits overwriting a user's dirty worktree                        | Snapshot tracked and safe untracked state into an isolated worktree, review there, and apply only the agent delta against the snapshot baseline.                                                  | Worktree dirty-state regression tests.                       |
| Parallel writers conflicting or editing outside assigned ownership     | Validate disjoint scopes, run writers in separate worktrees, compare actual changed paths to ownership, integrate and review off-main, and merge once only after acceptance.                      | Parallel plan, ownership, scheduler, and worktree tests.     |
| Malicious repository hooks or copied credentials in isolated worktrees | Bypass Git hooks for agent-created commits and exclude known credential/config paths from untracked snapshot copying.                                                                             | Worktree snapshot tests.                                     |
| Premature provider stream closure replaying a side-effecting turn      | Retry transport closure only before output; preserve partial-output state after any delta and require the Agent to reconcile rather than replaying tool calls.                                    | Provider stream and Agent fallback tests.                    |
| Provider model substitution or stale UI identity                       | Record requested and provider-resolved model identity, keep one conversation across model switches, and expose the active provider/model from runtime state rather than model prose.              | Provider identity, routing, and Web UI status tests.         |
| Dependency or package-content compromise                               | Audit production dependencies, allowlist packed files, enforce artifact size/version consistency, and publish only a verified artifact through a protected release environment.                   | `pnpm verify:release` and release workflow.                  |

## Accepted limitations

- A provider necessarily receives the prompt and selected context sent to it.
  Orbit cannot enforce that provider's retention or training policy.
- Full Access (`auto`) intentionally approves every tool risk, including
  dangerous operations, protected files, opaque interpreters, and paths outside
  the workspace. Local and private network targets are also available.
  Filesystem tools and commands can act anywhere permitted by the current
  operating-system account, and child commands inherit the Orbit process
  environment, including credential variables. Credential values remain
  redacted from logs, events, sessions, and model-visible output. Already-running
  child processes retain their inherited environment and OS authority until
  stopped, even after Full Access is disabled. Full Access skips secondary
  permission prompts, including post-write acceptance, dependency installation,
  auto-repair, and failed pre-commit confirmation, but is not an OS security
  boundary; it is inappropriate for unknown repositories, untrusted scripts,
  or MCP servers. Outside-workspace changes are not covered by Orbit checkpoints
  or rollback. Input schemas, bounded output, cancellation, timeouts, project
  hooks, verification contracts, budgets, stalled-loop detection, and the
  configured final iteration ceiling remain active because they are
  workflow/runtime controls, not permission guards. Periodic iteration
  checkpoints are recorded but continue without asking in Full Access.
- A process running as the same operating-system user may be able to inspect
  that user's files or process memory. Orbit does not provide an OS security
  boundary.
- Agent-authored commands run in the host's native non-interactive shell
  (PowerShell on Windows, Bash/POSIX sh on macOS/Linux). Browser-facing command
  summaries are bounded and credential-redacted; the full local execution risk
  remains governed by the selected permission mode.
- macOS keeps the credential encryption key in the user's Keychain and migrates
  legacy restricted key files on first use. Linux and systems without an
  available native key store use a restricted local master key. Operating-system
  account compromise can still expose credentials available to that account.
- Generated code and model reasoning may be incorrect. Verification reduces
  risk but is not a substitute for review in safety-critical systems.

## Release security gate

Before a commercial release:

1. Run `pnpm verify:release` from a clean checkout and retain the redacted log.
2. Perform the credentialed provider smoke tests from the commercial checklist
   with a dedicated low-privilege account.
3. Test Web UI authentication from a fresh browser profile, including invalid
   token, cross-origin, oversized-body, reconnect, and cancellation cases.
4. Inspect the npm tarball and checksum; confirm no source maps, local state,
   keys, fixtures containing secrets, or private paths are present.
5. Review new tools, MCP capabilities, persisted schemas, network endpoints,
   dependencies, and permission changes against this threat table.
6. Record the incident owner and rollback path before publication.

Any new feature that crosses a boundary above must add a focused regression
test and update this model when it changes the accepted risk.
