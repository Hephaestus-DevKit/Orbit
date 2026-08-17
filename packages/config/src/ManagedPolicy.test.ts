import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "crypto";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_CONFIG } from "./defaults.js";
import {
  applyManagedPolicy,
  loadManagedPolicy,
  buildManagedPolicySignaturePayload,
  ManagedPolicySchema,
  ManagedPolicyBundleSchema,
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
      disableExtensionTools: true,
      requireSignedAcpRegistry: true,
      acpRegistryTrustRoots: { release: "acp-public-key" },
      windowsSandboxTrustRoots: { release: "windows-public-key" },
      allowedExtensions: ["com.example.docs"],
      disableExtensionTools: true,
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
      requireSignedAcpRegistry: true,
      acpRegistryTrustRoots: { release: "acp-public-key" },
      windowsSandboxTrustRoots: { release: "windows-public-key" },
      allowedExtensions: ["com.example.docs"],
    });
    expect(result.tools.webSearch.enabled).toBe(false);
    expect(result.tools.mcp.enabled).toBe(false);
    expect(result.security.requireSignedAcpRegistry).toBe(true);
    expect(result.security.acpRegistryTrustRoots).toEqual({
      release: "acp-public-key",
    });
    expect(result.security.windowsSandboxTrustRoots).toEqual({
      release: "windows-public-key",
    });
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

  it("can centrally disable executable extension hooks without removing user hooks", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.hooks = {
      lifecycle: {
        sessionStart: [
          {
            command: "node extension-hook.mjs",
            timeoutMs: 30_000,
            onFailure: "warn",
            extension: {
              id: "com.example.review",
              root: "C:/Users/test/.orbit/extensions/com.example.review",
            },
          },
        ],
        stop: [
          {
            command: "node local-hook.mjs",
            timeoutMs: 30_000,
            onFailure: "warn",
          },
        ],
      },
    };
    const result = applyManagedPolicy(
      config,
      ManagedPolicySchema.parse({
        schemaVersion: 1,
        disableExtensionHooks: true,
      }),
    );
    expect(result.hooks.lifecycle?.sessionStart).toBeUndefined();
    expect(result.hooks.lifecycle?.stop).toHaveLength(1);
    expect(result.managedPolicy?.disableExtensionHooks).toBe(true);
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

  it("verifies signed policy bundles and rejects tampering or unsigned policy in strict mode", () => {
    const directory = mkdtempSync(join(tmpdir(), "orbit-signed-policy-"));
    try {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const base = ManagedPolicyBundleSchema.parse({
        schemaVersion: 1,
        policy: {
          schemaVersion: 1,
          disableWebSearch: true,
        },
        metadata: {
          policyId: "org-default",
          owner: "security-team",
          revision: 7,
          issuedAt: "2026-08-16T00:00:00.000Z",
          expiresAt: "2026-08-17T00:00:00.000Z",
        },
        signature: {
          algorithm: "ed25519",
          keyId: "release",
          value: "AA==",
        },
      });
      const { payload } = buildManagedPolicySignaturePayload(base);
      const bundle = {
        ...base,
        signature: {
          ...base.signature,
          value: sign(null, Buffer.from(payload, "utf8"), privateKey).toString(
            "base64",
          ),
        },
      };
      const path = join(directory, "policy.json");
      writeFileSync(path, JSON.stringify(bundle));
      const trustRoots = {
        release: publicKey.export({ type: "spki", format: "pem" }).toString(),
      };
      expect(
        loadManagedPolicy(path, {
          trustRoots,
          now: () => new Date("2026-08-16T12:00:00.000Z"),
        }).disableWebSearch,
      ).toBe(true);

      const tampered = {
        ...bundle,
        policy: { ...bundle.policy, disableMcp: true },
      };
      writeFileSync(path, JSON.stringify(tampered));
      expect(() =>
        loadManagedPolicy(path, {
          trustRoots,
          now: () => new Date("2026-08-16T12:00:00.000Z"),
        }),
      ).toThrow(/signature is invalid/);

      writeFileSync(
        path,
        JSON.stringify({ schemaVersion: 1, disableWebSearch: true }),
      );
      expect(() =>
        loadManagedPolicy(path, {
          requireSignature: true,
        }),
      ).toThrow(/signature is required/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
