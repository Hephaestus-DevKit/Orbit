# Orbit Agent Guidelines & Development Specifications

This document outlines the development guidelines, code standards, user experience (UX) requirements, and efficiency practices for the Orbit project.

---

## 1. Industry Code Standards (行业代码规范)

### TypeScript & ESM

- **ES Modules**: Write strictly modular ES Modules (`import/export` with `.js` extensions in imports).
- **Type Safety**: Strictly avoid `any` types unless absolutely necessary (e.g., interfacing with highly dynamic third-party libraries). Use proper generic typing and interfaces.
- **Input Validation**: Define robust Zod schemas for all external boundaries (configuration files, IPC events, API contracts, checkpoint states).

### Code Quality & Linting

- **Self-Documenting Code**: Keep function names clear and self-documenting. Use TSDoc/JSDoc format for public functions and classes.
- **Linting & Formatting**: Ensure all files conform strictly to the configured ESLint and dprint rules.
- **No Side-Effects in Constructors**: Class constructors must only initialize state. Place any side-effects, I/O, or asynchronous calls in explicit initialization/start methods.

### Workspace Isolation & Security

- **Path Verification**: All file operations must conform strictly to workspace boundaries to prevent directory traversal.
- **Credential Protection**: Do not output plaintext API keys or credentials. Use `CredentialsManager` for OS-level secure credential storage.

---

## 2. User Experience Specifications (用户体验规范 - UX)

### Terminal User Interface (TUI) Aesthetics

- **Color Systems**: Use curated, consistent color schemes (via `picocolors`). Use yellow for warnings, red for errors, green for success, and gray/cyan for metadata/progress streams.
- **Aesthetic Symbols**: Emphasize operations using consistent unicode bullet points:
  - `●` Processing/Running
  - `✔` Success/Completed
  - `✖` Failure/Blocked
  - `⚠️` Warning/Fallback
- **Paging & Diffs**: Interactive diff outputs or long textual lists must be presented via `pageText` paging or FullscreenTui, avoiding terminal stdout clutter.

### Real-Time Transparency & Logs

- **Event-Driven UI**: All long-running processes (indexing, coding loops, verification contracts) must emit status updates to the centralized `eventBus` rather than printing directly to console.
- **Clean Failure Summary**: Distill raw stack traces or long CLI runner failure logs into dense, actionable failure summaries (what failed, why, and how to fix it).

### Fault Tolerance & Fallbacks

- **Graceful Degradation**: Always provide functional, safe fallback flows when system dependencies are missing (e.g. degrade to main workspace if Git is missing; degrade to text-only mode if TUI/stdin is not interactive).

---

## 3. Technical Efficiency & Architecture (技术高效与架构)

### Performance & Memory Optimization

- **Parallel Worktree Isolation**: Subagents must run in isolated Git worktrees (`WorktreeManager`) off the main codebase.
  - Bypass git hooks (`--no-verify`) during automatic subagent commits to avoid workspace lockouts.
  - Clean up temporary branches (`git branch -D`) on both normal exits and aborts to prevent branch pollution.
- **Incremental Caching**: Cache expensive operations (such as file embeddings in `SymbolIndexer` and RAG symbol hashes) to minimize redundant LLM token usage and disk I/O.
- **Automatic Compaction**: Regularly compact older chat histories or large codebase maps to maintain a bounded LLM context size and lower token costs.

### Testing & Verification Contracts

- **Verification Contracts**: Every modification flow should run automated verification tasks (build, test, lint) defined by the contract. If verification fails, run automatic error-repair before falling back to manual intervention.
- **Test-Driven Design**: Write robust unit tests (using the Node test runner) for all newly introduced modules. Mock out system dependencies (like Git shell commands) inside tests to guarantee fast, non-flaky test execution.
