import { fileURLToPath } from "node:url";

function workspaceSource(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/** Resolve workspace packages to source so tests never depend on stale dist output. */
export const workspaceAliases = {
  "@orbit-build/acp": workspaceSource("./packages/acp/src/index.ts"),
  "@orbit-build/cli": workspaceSource("./packages/cli/src/index.ts"),
  "@orbit-build/config": workspaceSource("./packages/config/src/index.ts"),
  "@orbit-build/context-engine": workspaceSource(
    "./packages/context-engine/src/index.ts",
  ),
  "@orbit-build/core": workspaceSource("./packages/core/src/index.ts"),
  "@orbit-build/daemon": workspaceSource("./packages/daemon/src/index.ts"),
  "@orbit-build/mcp": workspaceSource("./packages/mcp/src/index.ts"),
  "@orbit-build/model-providers": workspaceSource(
    "./packages/model-providers/src/index.ts",
  ),
  "@orbit-build/permissions": workspaceSource(
    "./packages/permissions/src/index.ts",
  ),
  "@orbit-build/sandbox": workspaceSource("./packages/sandbox/src/index.ts"),
  "@orbit-build/session": workspaceSource("./packages/session/src/index.ts"),
  "@orbit-build/shared": workspaceSource("./packages/shared/src/index.ts"),
  "@orbit-build/tools": workspaceSource("./packages/tools/src/index.ts"),
  "@orbit-build/tui": workspaceSource("./packages/tui/src/index.ts"),
} as const;

export const testExcludes = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/.orbit/**",
  "**/.pytest_cache/**",
  "**/.mypy_cache/**",
  "**/.ruff_cache/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/.tox/**",
  "**/.nox/**",
  "**/e2e/**",
  "**/rag-test-temp/**",
  "**/hunk-test-temp/**",
] as const;
