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
                     mcp ─────────────────────────┘
```

Lower layers must not import `core` or `cli`. Provider protocol behavior lives
in `model-providers`; workspace policy lives in `permissions` and `sandbox`;
durable data lives in `session`; orchestration lives in `core`; presentation
and process assembly live in `cli`.

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

| Boundary                      | Required invariant                                                                                                           | Primary owners                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Configuration and credentials | Zod validation, encrypted/native storage, corruption fails closed, no plaintext diagnostics                                  | `config`, `shared/redaction.ts`           |
| Workspace child process       | Normal modes remove credential-bearing entries; explicit Full Access inherits a detached copy of the process environment     | `shared/childProcess.ts`, `tools`, `core` |
| Filesystem mutation           | Normal modes enforce canonical workspace/protected-path policy; explicit Full Access resolves against host-account authority | `tools`, `permissions`, `sandbox`         |
| Provider HTTP/SSE             | Bounded bodies/frames, schema validation, abort and timeout propagation, sanitized errors                                    | `model-providers`                         |
| UI event stream               | Serializable allowlisted events, opaque WebUI capability token, no raw secret/tool payload leakage                           | `core/events`, `cli/runtime/webui`        |
| Local persistence             | Private permissions, bounded reads, atomic replacement, recoverable journal/snapshot formats                                 | `session`, `shared`                       |
| Release                       | Immutable action revisions, clean exact tag, verified tarball, provenance, SBOM, registry reinstall check                    | `.github/workflows`, release checklist    |

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

| If this changes             | Review together                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Agent tool/history protocol | `AgentLoop`, provider mappers, session schemas, WebUI/TUI event consumers                 |
| DeepSeek V4 profile         | `DeepSeekV4`, Responses/OpenAI adapters, catalog, diagnostics, benchmark workflow         |
| Compatible provider wire    | `openai-compatible`, `anthropic-compatible`, canonical request and transport helpers      |
| Credential handling         | storage backend, redaction registry, child-process environment, diagnostic/event tests    |
| Session format              | schema, snapshot/journal recovery, backup/export, resume and delete flows                 |
| Context index               | language parser, ignore rules, vector/BM25 persistence, token fitting, retrieval tests    |
| Parallel writer plan        | ownership normalization, scheduler cancellation, worktrees, integration and review merge  |
| WebUI behavior              | typed client fragment, page copy, responsive styles, keyboard/focus behavior, Playwright  |
| CUMCM Skill                 | `SKILL.md`, referenced rules, templates, validator/finalizer, deterministic workflow eval |
| Release workflow            | package contents, notices, audit, smoke install, provenance, SBOM and rollback notes      |

## Generated and runtime data

`dist/`, `coverage/`, `test-results/`, `node_modules/`, temporary worktrees, and
project/user `.orbit/` directories are outputs, not source modules. Never patch
them to implement behavior. A source change should be reviewable through its
owning module, colocated tests, and the relevant documentation or workflow.
