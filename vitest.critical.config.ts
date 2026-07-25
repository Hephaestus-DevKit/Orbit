import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20_000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.git/**",
      "**/.orbit/**",
      "**/e2e/**",
      "**/rag-test-temp/**",
      "**/hunk-test-temp/**",
    ],
    coverage: {
      enabled: true,
      provider: "v8",
      reportsDirectory: "coverage/critical",
      reporter: ["text", "json-summary"],
      include: [
        "packages/cli/src/runtime/CleanupManager.ts",
        "packages/cli/src/runtime/UpdateManager.ts",
        "packages/cli/src/runtime/webui/WebUiSecurity.ts",
        "packages/cli/src/runtime/webui/WebUiServer.ts",
        "packages/cli/src/runtime/review/ReviewCommand.ts",
        "packages/config/src/CredentialKeyStore.ts",
        "packages/config/src/Credentials.ts",
        "packages/core/src/agent/McpRuntimeManager.ts",
        "packages/sandbox/src/WorktreeManager.ts",
        "packages/sandbox/src/CheckpointManager.ts",
        "packages/sandbox/src/RollbackManager.ts",
        "packages/session/src/AgentRunStore.ts",
        "packages/session/src/SessionStore.ts",
        "packages/model-providers/src/deepseek/DeepSeekOpenAIProvider.ts",
        "packages/model-providers/src/deepseek/DeepSeekAnthropicProvider.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 85,
        lines: 75,
      },
    },
  },
});
