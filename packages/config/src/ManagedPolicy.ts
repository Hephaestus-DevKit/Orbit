import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { OrbitConfig } from "./schema.js";
import { readBoundedRegularFile } from "@orbit-build/shared";

const MAX_MANAGED_POLICY_BYTES = 1024 * 1024;

export const ManagedPolicySchema = z.object({
  schemaVersion: z.literal(1),
  allowedProviders: z.array(z.string().min(1).max(256)).max(100).optional(),
  allowedModels: z.array(z.string().min(1).max(256)).max(500).optional(),
  minimumPermissionMode: z
    .enum(["auto", "normal", "strict", "plan"])
    .optional(),
  requireWriteApproval: z.boolean().default(true),
  requireBashApproval: z.boolean().default(true),
  disableWebSearch: z.boolean().default(false),
  disableMcp: z.boolean().default(false),
  maxBudgetUsd: z.number().finite().positive().max(1_000_000).optional(),
  maxIterations: z.number().int().positive().max(1000).optional(),
  protectedPaths: z.array(z.string().min(1).max(4096)).max(1000).default([]),
});

export type ManagedPolicy = z.infer<typeof ManagedPolicySchema>;

/** Load an administrator-owned policy file without accepting unknown fields. */
export function loadManagedPolicy(filePath: string): ManagedPolicy {
  const raw = readBoundedRegularFile(filePath, MAX_MANAGED_POLICY_BYTES, {
    allowSymbolicLink: true,
  });
  if (raw === undefined) {
    throw new Error(`Managed policy file was not found: ${filePath}`);
  }
  const value = filePath.toLowerCase().endsWith(".json")
    ? JSON.parse(raw)
    : parseYaml(raw);
  return ManagedPolicySchema.strict().parse(value);
}

/** Apply policy last so project, environment, and CLI flags cannot weaken it. */
export function applyManagedPolicy(
  source: OrbitConfig,
  policy: ManagedPolicy,
): OrbitConfig {
  const config = structuredClone(source);
  let effectiveAllowedProviders = policy.allowedProviders;
  if (policy.allowedProviders?.length) {
    const allowed = new Set(
      policy.allowedProviders.flatMap((id) => {
        if (config.providers[id]) return [id];
        if (
          config.providers.deepseek &&
          (id === "deepseek-openai" || id === "deepseek-anthropic")
        ) {
          return ["deepseek"];
        }
        return [id];
      }),
    );
    effectiveAllowedProviders = [...allowed];
    config.providers = Object.fromEntries(
      Object.entries(config.providers).filter(([id]) => allowed.has(id)),
    );
    if (!config.providers[config.provider.default]) {
      const replacement = effectiveAllowedProviders.find(
        (id) => config.providers[id],
      );
      if (!replacement) {
        throw new Error(
          "Managed policy does not allow any configured model provider.",
        );
      }
      config.provider.default = replacement;
    }
    if (
      config.provider.embedding &&
      !config.providers[config.provider.embedding]
    ) {
      delete config.provider.embedding;
    }
  }

  if (policy.allowedModels?.length) {
    const allowed = new Set(policy.allowedModels);
    const fallback = policy.allowedModels[0];
    for (const key of [
      "default",
      "fast",
      "planner",
      "coder",
      "reviewer",
      "summarizer",
    ] as const) {
      if (!allowed.has(config.models[key])) config.models[key] = fallback;
    }
    for (const provider of Object.values(config.providers)) {
      if (provider.models) {
        provider.models = provider.models.filter((model) => allowed.has(model));
      }
    }
  }

  if (
    policy.minimumPermissionMode &&
    permissionRank(config.permissions.mode) <
      permissionRank(policy.minimumPermissionMode)
  ) {
    config.permissions.mode = policy.minimumPermissionMode;
  }
  if (policy.requireWriteApproval) {
    config.permissions.requireApprovalForWrite = true;
  }
  if (policy.requireBashApproval) {
    config.permissions.requireApprovalForBash = true;
  }
  if (
    config.permissions.mode !== "auto" ||
    policy.requireWriteApproval ||
    policy.requireBashApproval
  ) {
    config.permissions.blockDangerousCommands = true;
    config.permissions.protectSecrets = true;
  }
  config.permissions.protectedPaths = Array.from(
    new Set([...config.permissions.protectedPaths, ...policy.protectedPaths]),
  );
  if (policy.disableWebSearch) config.tools.webSearch.enabled = false;
  if (policy.disableMcp) config.tools.mcp.enabled = false;
  if (policy.maxBudgetUsd !== undefined) {
    config.budgetLimit = Math.min(config.budgetLimit, policy.maxBudgetUsd);
  }
  if (policy.maxIterations !== undefined) {
    config.agent.maxIterations = Math.min(
      config.agent.maxIterations,
      policy.maxIterations,
    );
  }
  config.managedPolicy = {
    allowedProviders: effectiveAllowedProviders,
    allowedModels: policy.allowedModels,
    minimumPermissionMode: policy.minimumPermissionMode,
    requireWriteApproval: policy.requireWriteApproval,
    requireBashApproval: policy.requireBashApproval,
    disableWebSearch: policy.disableWebSearch,
    disableMcp: policy.disableMcp,
    maxIterations: policy.maxIterations,
  };
  return config;
}

/** Return an actionable reason when a live setting would weaken managed policy. */
export function validateManagedRuntimeChange(
  config: OrbitConfig,
  change: {
    provider?: string;
    model?: string;
    permissionMode?: OrbitConfig["permissions"]["mode"];
    requireWriteApproval?: boolean;
    requireBashApproval?: boolean;
    webSearchEnabled?: boolean;
    agentMaxIterations?: number;
  },
): string | undefined {
  const policy = config.managedPolicy;
  if (!policy) return undefined;
  if (
    change.provider &&
    policy.allowedProviders?.length &&
    !policy.allowedProviders.includes(change.provider)
  ) {
    return `Managed policy does not allow provider ${change.provider}.`;
  }
  if (
    change.model &&
    change.model !== "__auto__" &&
    policy.allowedModels?.length &&
    !policy.allowedModels.includes(change.model)
  ) {
    return `Managed policy does not allow model ${change.model}.`;
  }
  if (
    change.permissionMode &&
    policy.minimumPermissionMode &&
    permissionRank(change.permissionMode) <
      permissionRank(policy.minimumPermissionMode)
  ) {
    return `Managed policy requires ${policy.minimumPermissionMode} mode or stricter.`;
  }
  if (change.requireWriteApproval === false && policy.requireWriteApproval) {
    return "Managed policy requires write approval.";
  }
  if (change.requireBashApproval === false && policy.requireBashApproval) {
    return "Managed policy requires command approval.";
  }
  if (change.webSearchEnabled && policy.disableWebSearch) {
    return "Managed policy disables web search.";
  }
  if (
    change.agentMaxIterations !== undefined &&
    policy.maxIterations !== undefined &&
    change.agentMaxIterations > policy.maxIterations
  ) {
    return `Managed policy limits agent runs to ${policy.maxIterations} iterations.`;
  }
  return undefined;
}

function permissionRank(mode: OrbitConfig["permissions"]["mode"]): number {
  return { auto: 0, normal: 1, strict: 2, plan: 3 }[mode];
}
