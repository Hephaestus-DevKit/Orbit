import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  applyManagedPolicy,
  loadManagedPolicy,
  ManagedPolicySchema,
  validateManagedRuntimeChange,
} from "./ManagedPolicy.js";

describe("managed policy", () => {
  it("applies non-bypassable provider, model, permission, tool, and budget limits", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.permissions.mode = "auto";
    config.permissions.requireApprovalForWrite = false;
    config.permissions.requireApprovalForBash = false;
    config.permissions.blockDangerousCommands = false;
    config.permissions.protectSecrets = false;
    config.permissions.protectedPaths = [".git"];
    config.budgetLimit = 100;
    config.agent.maxIterations = 50;
    const policy = ManagedPolicySchema.parse({
      schemaVersion: 1,
      allowedProviders: ["deepseek-openai"],
      allowedModels: ["deepseek-v4-pro"],
      minimumPermissionMode: "strict",
      disableWebSearch: true,
      disableMcp: true,
      maxBudgetUsd: 2,
      maxIterations: 4,
      protectedPaths: ["secrets/**"],
    });

    const result = applyManagedPolicy(config, policy);

    expect(Object.keys(result.providers)).toEqual(["deepseek"]);
    expect(result.provider.default).toBe("deepseek");
    expect(result.models.default).toBe("deepseek-v4-pro");
    expect(result.permissions).toMatchObject({
      mode: "strict",
      requireApprovalForWrite: true,
      requireApprovalForBash: true,
      blockDangerousCommands: true,
      protectSecrets: true,
    });
    expect(result.permissions.protectedPaths).toEqual([".git", "secrets/**"]);
    expect(result.managedPolicy).toMatchObject({
      allowedProviders: ["deepseek"],
      requireWriteApproval: true,
      requireBashApproval: true,
      maxIterations: 4,
    });
    expect(result.tools.webSearch.enabled).toBe(false);
    expect(result.tools.mcp.enabled).toBe(false);
    expect(result.budgetLimit).toBe(2);
    expect(result.agent.maxIterations).toBe(4);
    expect(
      validateManagedRuntimeChange(result, { permissionMode: "auto" }),
    ).toContain("requires strict");
    expect(
      validateManagedRuntimeChange(result, { model: "unapproved-model" }),
    ).toContain("does not allow model");
    expect(
      validateManagedRuntimeChange(result, { webSearchEnabled: true }),
    ).toContain("disables web search");
    expect(
      validateManagedRuntimeChange(result, { agentMaxIterations: 5 }),
    ).toContain("4 iterations");
    expect(
      validateManagedRuntimeChange(result, {
        requireWriteApproval: false,
      }),
    ).toContain("write approval");
    expect(
      validateManagedRuntimeChange(result, {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        permissionMode: "plan",
      }),
    ).toBeUndefined();
  });

  it("fails closed when no configured provider is permitted", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    const policy = ManagedPolicySchema.parse({
      schemaVersion: 1,
      allowedProviders: ["missing-provider"],
    });

    expect(() => applyManagedPolicy(config, policy)).toThrow(
      "does not allow any configured model provider",
    );
  });

  it("loads bounded policy input and rejects oversized files", () => {
    const directory = mkdtempSync(join(tmpdir(), "orbit-policy-"));
    try {
      const policyPath = join(directory, "policy.yaml");
      writeFileSync(policyPath, "schemaVersion: 1\ndisableWebSearch: true\n");
      expect(loadManagedPolicy(policyPath).disableWebSearch).toBe(true);

      writeFileSync(policyPath, "x".repeat(1024 * 1024 + 1));
      expect(() => loadManagedPolicy(policyPath)).toThrow("byte limit");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
