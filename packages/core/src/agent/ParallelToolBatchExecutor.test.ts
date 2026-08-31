import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_CONFIG } from "@orbit-build/config";
import { PermissionEngine } from "@orbit-build/permissions";
import { ToolRegistry } from "@orbit-build/tools";
import type { SessionManager } from "@orbit-build/session";
import type { UserInteraction } from "./AgentInteraction.js";
import type { LoopProgressGuard } from "./LoopProgressGuard.js";
import type { StepRunner } from "./StepRunner.js";
import {
  executeParallelToolBatch,
  summarizeToolArguments,
  type ParallelToolBatchOptions,
} from "./ParallelToolBatchExecutor.js";

describe("ParallelToolBatchExecutor eligibility", () => {
  it("keeps concise path and search previews for the shared serial UI", () => {
    expect(
      summarizeToolArguments({
        id: "grep",
        name: "grep",
        arguments: JSON.stringify({ query: "contract", path: "packages" }),
      }),
    ).toBe('"contract" in packages');
    expect(
      summarizeToolArguments({
        id: "read",
        name: "read_file",
        arguments: JSON.stringify({ path: "src/index.ts" }),
      }),
    ).toBe("src/index.ts");
    expect(
      summarizeToolArguments({
        id: "grep-native",
        name: "grep",
        arguments: JSON.stringify({ pattern: "needle", path: "src" }),
      }),
    ).toBe('"needle" in src');
  });

  it("redacts credentials before truncating shared command previews", () => {
    const secret = `sk-${"fixture".repeat(20)}`;
    const summary = summarizeToolArguments({
      id: "secret-command",
      name: "bash",
      arguments: JSON.stringify({ command: `echo ${secret}` }),
    });

    expect(summary).toContain("***REDACTED***");
    expect(summary).not.toContain("sk-fixture");
    expect(summary.length).toBeLessThanOrEqual(80);
  });

  it("keeps command previews on one line without terminal control characters", () => {
    const summary = summarizeToolArguments({
      id: "control-command",
      name: "bash",
      arguments: JSON.stringify({ command: "echo a\r\nb\u001b[2J\u009b1G" }),
    });

    expect(summary).toBe("echo a  b [2J 1G");
  });

  it("falls back before execution when any tool lacks the explicit v2 contract", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ ok: true, data: "ok" }));
    registry.register(parallelReadTool("contracted", execute));
    registry.register({
      ...parallelReadTool("legacy", execute),
      execution: undefined,
    });

    const result = await executeParallelToolBatch(
      options(registry, ["contracted", "legacy"]),
    );

    expect(result).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("falls back before execution when a lifecycle hook applies", async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ ok: true, data: "ok" }));
    registry.register(parallelReadTool("first", execute));
    registry.register(parallelReadTool("second", execute));
    const fixture = options(registry, ["first", "second"]);
    fixture.hooks = {
      lifecycle: {
        preToolUse: [
          {
            command: "policy-check",
            matcher: "first",
            timeoutMs: 1_000,
            onFailure: "block",
          },
        ],
      },
    };

    const result = await executeParallelToolBatch(fixture);

    expect(result).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });
});

function parallelReadTool(
  name: string,
  execute: () => Promise<{ ok: boolean; data: string }>,
) {
  return {
    name,
    description: `${name} fixture`,
    risk: "read" as const,
    inputSchema: z.object({}),
    execution: {
      version: 2 as const,
      readOnly: true,
      idempotent: true,
      concurrency: "parallel" as const,
      cancellation: "cooperative" as const,
      outputSchema: z.string(),
    },
    execute,
  };
}

function options(
  registry: ToolRegistry,
  names: string[],
): ParallelToolBatchOptions {
  const config = {
    ...DEFAULT_CONFIG,
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      mode: "auto" as const,
      allowRead: true,
      protectSecrets: false,
    },
  };
  return {
    toolCalls: names.map((name, index) => ({
      id: `call-${index}`,
      name,
      arguments: "{}",
    })),
    protocolErrors: new Map(),
    finalResponseLocked: false,
    registry,
    permissionEngine: new PermissionEngine(config, process.cwd()),
    hooks: {},
    sessionId: "parallel-fixture",
    attempt: 1,
    stepRunner: {} as StepRunner,
    interaction: {} as UserInteraction,
    sessionManager: {} as SessionManager,
    progressGuard: {} as LoopProgressGuard,
    sessionCostLabel: "$0.0000",
  };
}
