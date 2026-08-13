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
3. `model-providers` converts the normalized message/tool protocol to the
   selected transport. DeepSeek V4 uses Responses when configured, with a
   bounded endpoint-unavailable circuit and Chat Completions fallback only in
   `auto` mode.
4. Every tool call passes `permissions`; filesystem targets are resolved inside
   the workspace before `tools` or `sandbox` can mutate state.
5. Structured, redacted events feed TUI and WebUI. Tool output sent back to the
   model is separately bounded.
6. `session` persists the recoverable state. History uses an atomic snapshot
   plus a fsynced tail journal and periodically compacts back to a snapshot.
7. Verification contracts run before a successful task or commit is reported.

## Trust boundaries

| Boundary                      | Required invariant                                                                                          | Primary owners                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Configuration and credentials | Zod validation, encrypted/native storage, corruption fails closed, no plaintext diagnostics                 | `config`, `shared/redaction.ts`           |
| Workspace child process       | Credential-bearing environment entries are removed; explicit non-secret build environment remains available | `shared/childProcess.ts`, `tools`, `core` |
| Filesystem mutation           | Canonical target stays in the authorized workspace and protected paths require policy approval              | `tools`, `permissions`, `sandbox`         |
| Provider HTTP/SSE             | Bounded bodies/frames, schema validation, abort and timeout propagation, sanitized errors                   | `model-providers`                         |
| UI event stream               | Serializable allowlisted events, opaque WebUI capability token, no raw secret/tool payload leakage          | `core/events`, `cli/runtime/webui`        |
| Local persistence             | Private permissions, bounded reads, atomic replacement, recoverable journal/snapshot formats                | `session`, `shared`                       |
| Release                       | Immutable action revisions, clean exact tag, verified tarball, provenance, SBOM, registry reinstall check   | `.github/workflows`, release checklist    |

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
silently discarded; an impossible hard budget fails visibly.

## Review neighborhoods

| If this changes             | Review together                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Agent tool/history protocol | `AgentLoop`, provider mappers, session schemas, WebUI/TUI event consumers                   |
| DeepSeek V4 profile         | `DeepSeekV4`, Responses/OpenAI/Anthropic adapters, catalog, diagnostics, benchmark workflow |
| Credential handling         | storage backend, redaction registry, child-process environment, diagnostic/event tests      |
| Session format              | schema, snapshot/journal recovery, backup/export, resume and delete flows                   |
| Context index               | language parser, ignore rules, vector/BM25 persistence, token fitting, retrieval tests      |
| WebUI behavior              | typed client fragment, page copy, responsive styles, keyboard/focus behavior, Playwright    |
| CUMCM Skill                 | `SKILL.md`, referenced rules, templates, validator/finalizer, deterministic workflow eval   |
| Release workflow            | package contents, notices, audit, smoke install, provenance, SBOM and rollback notes        |

## Generated and runtime data

`dist/`, `coverage/`, `test-results/`, `node_modules/`, temporary worktrees, and
project/user `.orbit/` directories are outputs, not source modules. Never patch
them to implement behavior. A source change should be reviewable through its
owning module, colocated tests, and the relevant documentation or workflow.
