# Orbit architecture map

This map is the review-oriented view of Orbit: where state crosses a trust
boundary, which package owns each decision, and which adjacent files must be
reviewed together. The maintainer guide remains the detailed change handbook.

## Dependency direction

```text
shared ─┬─> config ───────────────────────────────┐
        ├─> model-providers ─┐                    │
        ├─> tools ───────────┼─> core ───────────┼─> cli / WebUI / TUI
        ├─> permissions ─────┤                    │
        ├─> sandbox ─────────┤                    │
        ├─> session ─────────┤                    │
        └─> context-engine ──┘                    │
                     mcp ─────────────────────────┐
                     daemon ──────────────────────┘
```

Lower layers must not import `core` or `cli`. Provider protocol behavior lives
in `model-providers`; workspace policy lives in `permissions` and `sandbox`;
durable data lives in `session`; orchestration lives in `core`; presentation
and process assembly live in `cli`.

`packages/daemon` owns the cross-process task-control protocol independently of
the CLI and WebUI. It persists task state and bounded event journals, enforces
loopback/TLS and bearer-token policy at the HTTP boundary, and accepts an
injected runner so the CLI can own child execution without making the daemon
package depend on presentation code. `DaemonClient` is the typed consumer
boundary for desktop, WebUI, editor, and remote hosts: it shares response
schemas, bounds, cancellation, replay, follow, and redacted error semantics.
Task ownership is attempt-scoped: every claim receives a non-CLI lease token,
and heartbeat, event, and terminal transitions must present the current token.
Per-record exclusive locks serialize claims/resume/cancel/finish across daemon
processes, while a bounded stale-lock window permits crash recovery. A late
runner can therefore be observed but cannot write into a newer attempt.
The control plane also supports host-provided scoped principals. Read-only
clients can inspect health/tasks/events, submitters can enqueue work, control
clients can cancel/resume, and only admins can remove records or shut down the
daemon. The default token-file principal remains full local-admin for backward
compatibility. `JwtDaemonAuthenticator` adds an optional offline RS256/JWKS
identity adapter with issuer/audience, expiry, scope/role mapping and clock
skew validation; it can bridge an existing IdP without pretending to be an
OAuth login or central SSO service. `DaemonAuditLog` provides a local fsynced
SHA-256 hash chain, and `FleetCoordinator` provides signed job envelopes,
worker leases, stale-worker recovery, explicit patch ownership and rollback-
safe result digests. Hosted transport, centralized retention and organization
identity lifecycle remain deployment-owned adapters.

Review publication stays in the CLI command boundary because it is an optional
external side effect, not part of the persisted finding model. The provider-
neutral review exporter writes local JSON/SARIF; GitHub Checks, inline comments,
and workflow dispatch each validate their own request, default to dry-run, read
tokens only during explicit apply, enforce HTTPS/custom-host policy, and use
bounded/redacted responses. This keeps review evidence reproducible and makes
CI integration replaceable without coupling `core` or `session` to GitHub.

ACP registry files are discovery artifacts, not runtime authorization. Their
canonical unsigned document produces a stable SHA-256 digest; an optional
Ed25519 signature binds that document and digest to a configured trust root.
Invalid or unknown-key signatures are rejected, and signed-only deployments
can fail closed with `--require-signature`. Entry-level `trust: trusted` remains
a separate execution decision so signature provenance cannot silently grant
process authority. Hosted fetch adds a separate HTTPS transport contract:
registry ID, owner, monotonic revision, issue/expiry timestamps, ETag, bounded
body, cancellation, and atomic local pinning are verified before the document
enters the local discovery path. The transport still does not provide a central
index or organization identity service.

Process sandboxing is a separate execution boundary rather than a permission
mode. `sandbox` owns backend discovery and argv construction; `tools`, hooks,
and the background runtime pass the same mode/network/root policy into it.
macOS and Linux select only detected native tools. On Windows, the optional
`windows-appcontainer-helper` backend is selected only after the helper is a
regular non-symlink file whose actual SHA-256 matches the explicit environment
claim and whose Ed25519 signature verifies against the dedicated
`security.windowsSandboxTrustRoots` domain. A valid signature authenticates the
published helper artifact, not arbitrary extensions, MCP servers, providers, or
Full Access. `required` fails closed when the contract is absent; `auto` keeps
the host execution path but reports degradation in tool metadata and doctor.
Orbit passes roots and the original process argv as separate arguments and
never assembles a shell command for the helper. The repository now includes a
source/CMake implementation under `native/windows-appcontainer-helper`; a
release still has to compile, review, sign and install the binary before the
contract can be selected.

## One agent turn

1. `cli` validates command/config input and opens one interaction adapter.
2. `core/AgentLoop` consumes the durable queue at a safe boundary and asks
   `context-engine` for a hard-budget context pack.
3. `model-providers` resolves model-family semantics independently from the
   configured wire protocol, then canonicalizes normalized messages and tools
   at the selected transport boundary. One official DeepSeek product boundary
   owns isolated Chat, Responses, and Anthropic adapters; `auto` uses Chat
   unless a schema-constrained response benefits from Responses, while
   Anthropic is an explicit choice. Both compatible transports use the shared
   recursive tool/schema canonicalizer, so equivalent inputs produce the same
   capability view and cache-stable bytes. A DeepSeek model on TokenDance or
   another OpenAI/Anthropic-compatible gateway receives DeepSeek semantics but
   retains the gateway's exact model ID and wire contract. Legacy official
   `openai-compatible` profiles are upgraded at composition time.
4. Every tool call passes `permissions`; filesystem targets are resolved inside
   the workspace before `tools` or `sandbox` can mutate state.
5. Structured, redacted events feed TUI and WebUI. Tool output sent back to the
   model is separately bounded; failed commands retain a compact stderr/stdout
   diagnosis instead of collapsing to an exit code.
6. `session` persists the recoverable state. History uses an atomic snapshot
   plus a fsynced tail journal and periodically compacts back to a snapshot.
7. Verification contracts run before a successful modified task or commit is
   reported.
8. Every initialized run returns one structured receipt with relative changed
   paths, verification state, plan progress, usage, and cost availability. The
   receipt is also carried by `agent_completed` for JSONL and UI consumers.

The initial task is persisted as the new Session's durable goal before provider
work begins. Resume prompts restore history without overwriting that objective.

## Agent project and capability scaffolding

`cli/runtime/ProjectScaffolder.ts` owns `orbit init`. It detects only bounded,
well-known project manifests, writes within the canonical workspace, uses
exclusive non-overwriting creation, and generates a disabled-by-default
verification contract plus starter workflows. It never interprets a package
script during detection.

`cli/runtime/CapabilityScaffolder.ts` owns WebUI-created Skills and workflows.
Names and fields cross a Zod boundary; Skill bundles are assembled in a private
staging directory and atomically renamed into visibility. Workflows use an
exclusive final write. Both paths reject traversal, symbolic-link escapes, and
existing targets.

`config/AgentProfiles.ts` owns user/project Agent Profile discovery and
resolution. It parses bounded YAML/JSON manifests, applies deterministic
first-directory-wins precedence, rejects duplicate or unsafe files, and checks
provider/model/permission/iteration requests against managed policy before a
profile reaches `AgentLoop` or `Orchestrator`. Tool allow/deny lists are
enforced at the final tool-definition boundary, after global feature flags and
before prompt construction.

## Trust boundaries

| Boundary                        | Required invariant                                                                                                                                                                                                 | Primary owners                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Configuration and credentials   | Zod validation, encrypted/native storage, corruption fails closed, no plaintext diagnostics                                                                                                                        | `config`, `shared/redaction.ts`           |
| Administrator policy provenance | Optional signed policy bundles bind canonical policy bytes, owner/id/revision and expiry to a dedicated Ed25519 trust domain; signature acceptance never creates organization identity                             | `config`, `shared/canonicalJson.ts`       |
| ACP registry provenance         | Dedicated `acpRegistryTrustRoots`, canonical digest/signature verification, signed-only policy, and separate entry execution trust                                                                                 | `acp`, `config`, `cli`                    |
| Extension executable hooks      | Integrity-matched, explicitly trusted manifest hooks carry extension provenance and run from a read-only extension root in a required native sandbox with network denied; managed policy can remove them           | `config`, `cli`, `core`, `sandbox`        |
| Native process isolation        | Backend capability is detected without optimistic claims; Windows requires a separately signed helper contract, and root/network policy is carried as structured argv with required-mode fail-closed behavior      | `sandbox`, `tools`, `core`, `cli`         |
| Daemon identity and audit       | Static local principals or optional verified RS256/JWKS identities; bounded fsynced hash-chain audit with configurable fail-closed mode                                                                            | `daemon`, `config`, `shared`              |
| Fleet/offload ownership         | Signed job envelope, idempotent job IDs, worker lease/heartbeat, stale recovery, bounded retry, explicit patch owner/base revision/digest, bounded authenticated HTTP transport, and injected persistence boundary | `daemon`, hosted adapter                  |
| Workspace child process         | Normal modes remove credential-bearing entries; explicit Full Access inherits a detached copy of the process environment                                                                                           | `shared/childProcess.ts`, `tools`, `core` |
| Filesystem mutation             | Normal modes enforce canonical workspace/protected-path policy; explicit Full Access resolves against host-account authority                                                                                       | `tools`, `permissions`, `sandbox`         |
| Provider HTTP/SSE               | Bounded bodies/frames, schema validation, abort and timeout propagation, sanitized errors                                                                                                                          | `model-providers`                         |
| UI event stream                 | Serializable allowlisted events, opaque WebUI capability token, no raw secret/tool payload leakage                                                                                                                 | `core/events`, `cli/runtime/webui`        |
| Local persistence               | Private permissions, bounded reads, atomic replacement, recoverable journal/snapshot formats                                                                                                                       | `session`, `shared`                       |
| Release                         | Immutable action revisions, clean exact tag, verified tarball, provenance, SBOM, registry reinstall check                                                                                                          | `.github/workflows`, release checklist    |

## Retrieval and context

`LanguageParser.ts` is the only language dispatch point. TypeScript/JavaScript
use the compiler frontend, Python has a declaration-aware parser, and Go,
Rust, Java, C#, C/C++, and SQL use conservative declaration extraction. Text
formats can participate in lexical/vector retrieval without inventing symbols.
Configuration formats are deliberately excluded from the default glob because
they commonly contain credentials.

`SymbolIndexer` batches embedding and lexical persistence, bounds cache size,
and degrades to BM25 when embeddings are unavailable. `ContextPackBuilder`
bounds file fan-out and concurrency, then reduces excerpts, automatic Skills,
and metadata in a deterministic order. Explicitly requested Skills are never
silently discarded; an impossible hard budget fails visibly. Automatic
retrieval separately caps search matches, symbol references, and the landmark
map, while explicit `@codebase` receives a larger bounded budget. Implicit Skill
activation needs two independent lexical signals unless the Skill name itself
is mentioned, so generic task vocabulary cannot pull unrelated procedures into
the model prefix.

## Parallel writer integration

`ParallelWorkPlan` accepts one safe workspace writer or two to four independent
writers whose normalized scopes do not overlap. `Orchestrator` gives every
writer the same trusted baseline in a separate worktree and verifies its actual
changed paths against declared ownership. `WorktreeManager` applies each
binary-safe writer delta to a dedicated integration worktree. Reviewers inspect
that combined state; only an accepted integration is merged into the user's
workspace. A conflict resets the integration target and preserves writer state
when cleanup cannot be proven, while the main workspace and user-staged state
remain untouched.

## Review neighborhoods

| If this changes             | Review together                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Agent tool/history protocol | `AgentLoop`, provider mappers, session schemas, WebUI/TUI event consumers                                  |
| DeepSeek V4 profile         | `DeepSeekV4`, Responses/OpenAI adapters, catalog, diagnostics, benchmark workflow                          |
| Compatible provider wire    | `openai-compatible`, `anthropic-compatible`, canonical request and transport helpers                       |
| Credential handling         | storage backend, redaction registry, child-process environment, diagnostic/event tests                     |
| Session format              | schema, snapshot/journal recovery, backup/export, resume and delete flows                                  |
| Context index               | language parser, ignore rules, vector/BM25 persistence, token fitting, retrieval tests                     |
| Parallel writer plan        | ownership normalization, scheduler cancellation, worktrees, integration and review merge                   |
| WebUI behavior              | typed client fragment, page copy, responsive styles, keyboard/focus behavior, Playwright                   |
| Review publication          | review artifact schema, SARIF export, GitHub Checks/comments/dispatch adapters, token redaction, CLI smoke |
| CUMCM Skill                 | `SKILL.md`, referenced rules, templates, validator/finalizer, deterministic workflow eval                  |
| Release workflow            | package contents, notices, audit, smoke install, provenance, SBOM and rollback notes                       |

## Generated and runtime data

`dist/`, `coverage/`, `test-results/`, `node_modules/`, temporary worktrees, and
project/user `.orbit/` directories are outputs, not source modules. Never patch
them to implement behavior. A source change should be reviewable through its
owning module, colocated tests, and the relevant documentation or workflow.
