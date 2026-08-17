# `@orbit-build/daemon`

The daemon package owns Orbit's authenticated, durable task-control protocol.
It is intentionally independent from the CLI and WebUI so a future desktop,
editor, or remote client can use the same lifecycle contract.

The default listener is loopback-only and requires a bearer token. Non-loopback
listeners require TLS and an explicit caller opt-in. Task records and bounded
event journals are private, schema-validated, resumable, and never treat a
dead daemon process as a successful task. Hosts may provide scoped principals
(`read`, `submit`, `control`, `admin`) for desktop/editor integrations; the
legacy token-file principal remains a full local-admin capability.

For deployments that already own an identity provider, `JwtDaemonAuthenticator`
verifies short-lived RS256 bearer tokens against an administrator-supplied
offline JWKS, issuer, audience, scope/role mapping, and clock-skew policy. The
CLI exposes this as `daemon start --jwks <file> --issuer <url> --audience <id>`.
It is an identity verification adapter, not an OAuth login or hosted SSO
service; key rotation and IdP lifecycle remain deployment responsibilities.

## Lifecycle

The v1 API exposes authenticated health, task submission/list/inspection,
bounded SSE event replay, cancellation, explicit resume, terminal-record
removal, and shutdown. The CLI maps these to:

```text
orbit daemon start|status|submit|tasks|inspect|events|cancel|resume|remove|stop
```

Non-CLI hosts should use the exported `DaemonClient` instead of reimplementing
HTTP or SSE parsing. It validates every response against the v1 schemas,
bounds response/frame size, supports replay and follow callbacks, and keeps
the bearer token out of diagnostics.

The CLI exposes the same remote boundary for operational handoff:
`orbit daemon status|submit|tasks|inspect|events|cancel|resume|remove|stop
--url https://host:port --token-env ORBIT_DAEMON_TOKEN`. `start` remains a
local lifecycle operation. Plain HTTP is accepted only for loopback, while
non-loopback clients must use HTTPS; the token is never accepted as a command
line argument or printed in results. Remote `submit` requires an explicit
`--cwd` because a client-side absolute path cannot safely be assumed to exist
on the daemon host.

Queued work is claimed with an owner lease and renewed by heartbeats. Each
attempt receives a non-CLI lease token; heartbeat, event, and terminal writes
must present that token, so a late runner from an older attempt cannot mutate a
new owner's record. Task transitions use an exclusive per-record lock with a
bounded stale-lock recovery window, preventing two daemon processes from
claiming the same queued task. A daemon restart marks an unfinished owner as
`orphaned`; only an explicit resume starts a new attempt. Cancellation clears
ownership and terminates the child process tree. Terminal records remain
inspectable until the authenticated caller selects one with `remove`.

All bodies, records, prompts, errors, task catalogs, events, and client counts
are bounded. Event followers receive keepalives; slow or excessive followers
are disconnected instead of creating unbounded memory pressure. Token creation
is exclusive and atomic, metadata is schema-validated, journal symlinks are
rejected, and task workspaces must resolve beneath an allowed root.

Hosts may attach `DaemonAuditLog` to persist a bounded, fsynced JSONL audit
chain. Each record binds principal, authentication method, action, outcome,
request/task identifiers, redacted metadata, and a SHA-256 predecessor digest.
`requireAudit` makes the server fail closed if the configured sink cannot be
verified or appended. The log is a local tamper-evident export primitive, not a
central SIEM or organization retention backend.

`FleetCoordinator` and `FleetProtocol` provide the provider-neutral offload
contract: signed job envelopes, worker leases, stale-worker recovery, bounded
retry, explicit patch ownership, result digests, cancellation, and durable
persistence injection. `FleetHttpServer` and `FleetHttpClient` now provide the
typed transport boundary for a local or hosted adapter: signed submission with
idempotent job IDs, read/submit/worker/control/admin scopes, bounded JSON,
HTTPS-or-loopback policy, lease/heartbeat/complete/cancel endpoints, optional
worker-principal `workerIds` binding, and optional fail-closed hash-chain audit.
Hosted deployments should enable `requireWorkerBinding` unless their external
authenticator enforces an equivalent worker identity constraint. The transport
never transfers workspace bytes or grants execution trust; deployment owners
still provide storage, patch transfer, tenancy, key rotation, and rollback
policy.
