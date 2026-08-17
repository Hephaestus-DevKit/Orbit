import { createHash, createPublicKey, verify as verifySignature } from "crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { OrbitConfig } from "./schema.js";
import {
  canonicalJsonStringify,
  readBoundedRegularFile,
} from "@orbit-build/shared";

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
  disableExternalAgents: z.boolean().default(false),
  /** Disable executable lifecycle hooks contributed by installed extensions. */
  disableExtensionHooks: z.boolean().default(false),
  /** Disable executable tools contributed by installed extensions. */
  disableExtensionTools: z.boolean().default(false),
  /** If present, only these installed extension IDs may contribute anything. */
  allowedExtensions: z
    .array(z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/))
    .max(500)
    .optional(),
  extensionTrustRoots: z
    .record(z.string().min(1).max(16_384))
    .refine((value) => Object.keys(value).length <= 50, {
      message: "extensionTrustRoots cannot contain more than 50 keys.",
    })
    .optional(),
  requireSignedAcpRegistry: z.boolean().default(false),
  acpRegistryTrustRoots: z
    .record(z.string().min(1).max(16_384))
    .refine((value) => Object.keys(value).length <= 50, {
      message: "acpRegistryTrustRoots cannot contain more than 50 keys.",
    })
    .optional(),
  windowsSandboxTrustRoots: z
    .record(z.string().min(1).max(16_384))
    .refine((value) => Object.keys(value).length <= 50, {
      message: "windowsSandboxTrustRoots cannot contain more than 50 keys.",
    })
    .optional(),
  maxBudgetUsd: z.number().finite().positive().max(1_000_000).optional(),
  maxIterations: z.number().int().positive().max(1000).optional(),
  protectedPaths: z.array(z.string().min(1).max(4096)).max(1000).default([]),
});

export type ManagedPolicy = z.infer<typeof ManagedPolicySchema>;

export const ManagedPolicyTrustRootsSchema = z
  .record(z.string().min(1).max(16_384))
  .refine((value) => Object.keys(value).length <= 50, {
    message: "Managed policy trust roots cannot contain more than 50 keys.",
  });

export const ManagedPolicyBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    policy: ManagedPolicySchema.strict(),
    metadata: z
      .object({
        policyId: z.string().min(1).max(256),
        owner: z.string().min(1).max(256),
        revision: z
          .number()
          .int()
          .nonnegative()
          .max(2 ** 53 - 1),
        issuedAt: z.string().datetime(),
        expiresAt: z.string().datetime().optional(),
      })
      .strict(),
    signature: z
      .object({
        algorithm: z.literal("ed25519"),
        keyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
        value: z
          .string()
          .regex(/^[A-Za-z0-9+/]+={0,2}$/)
          .max(16_384),
      })
      .strict(),
  })
  .strict();

export type ManagedPolicyBundle = z.infer<typeof ManagedPolicyBundleSchema>;

export interface ManagedPolicyLoadOptions {
  trustRoots?: Record<string, string>;
  requireSignature?: boolean;
  now?: () => Date;
}

/** Load an administrator-owned policy file without accepting unknown fields. */
export function loadManagedPolicy(
  filePath: string,
  options: ManagedPolicyLoadOptions = {},
): ManagedPolicy {
  const raw = readBoundedRegularFile(filePath, MAX_MANAGED_POLICY_BYTES, {
    allowSymbolicLink: true,
  });
  if (raw === undefined) {
    throw new Error(`Managed policy file was not found: ${filePath}`);
  }
  const value = filePath.toLowerCase().endsWith(".json")
    ? JSON.parse(raw)
    : parseYaml(raw);
  if (isManagedPolicyBundle(value)) {
    const bundle = ManagedPolicyBundleSchema.parse(value);
    verifyManagedPolicyBundle(bundle, options);
    return bundle.policy;
  }
  if (options.requireSignature) {
    throw new Error("Managed policy signature is required.");
  }
  return ManagedPolicySchema.strict().parse(value);
}

/** Build the stable bytes an administrator signs, including provenance. */
export function buildManagedPolicySignaturePayload(
  bundle: ManagedPolicyBundle,
): {
  digest: string;
  payload: string;
} {
  const unsigned = {
    schemaVersion: bundle.schemaVersion,
    policy: bundle.policy,
    metadata: bundle.metadata,
  };
  const digest = createHash("sha256")
    .update(canonicalJsonStringify(unsigned), "utf8")
    .digest("hex");
  return {
    digest,
    payload: canonicalJsonStringify({ policy: unsigned, digest }),
  };
}

export function verifyManagedPolicyBundle(
  bundle: ManagedPolicyBundle,
  options: Pick<ManagedPolicyLoadOptions, "trustRoots" | "now"> = {},
): void {
  const now = options.now ?? (() => new Date());
  const issuedAt = Date.parse(bundle.metadata.issuedAt);
  const expiresAt = bundle.metadata.expiresAt
    ? Date.parse(bundle.metadata.expiresAt)
    : undefined;
  const current = now().getTime();
  const maxFutureSkewMs = 5 * 60 * 1_000;
  if (!Number.isFinite(issuedAt) || issuedAt > current + maxFutureSkewMs) {
    throw new Error(
      "Managed policy bundle issuedAt is invalid or too far in the future.",
    );
  }
  if (
    expiresAt !== undefined &&
    (!Number.isFinite(expiresAt) || expiresAt <= current)
  ) {
    throw new Error("Managed policy bundle has expired.");
  }
  const trustRoot = options.trustRoots?.[bundle.signature.keyId];
  if (!trustRoot) {
    throw new Error(
      `Managed policy signature key is not trusted: ${bundle.signature.keyId}.`,
    );
  }
  const { payload } = buildManagedPolicySignaturePayload(bundle);
  let valid = false;
  try {
    valid = verifySignature(
      null,
      Buffer.from(payload, "utf8"),
      createPublicKey(trustRoot),
      Buffer.from(bundle.signature.value, "base64"),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("Managed policy signature is invalid.");
}

function isManagedPolicyBundle(value: unknown): value is ManagedPolicyBundle {
  return (
    typeof value === "object" &&
    value !== null &&
    "policy" in value &&
    "signature" in value &&
    "metadata" in value
  );
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
  if (policy.disableExternalAgents) config.externalAgents = {};
  if (policy.disableExtensionHooks && config.hooks.lifecycle) {
    for (const event of Object.keys(config.hooks.lifecycle) as Array<
      keyof NonNullable<OrbitConfig["hooks"]["lifecycle"]>
    >) {
      const hooks = config.hooks.lifecycle[event];
      if (!hooks) continue;
      const retained = hooks.filter((hook) => !hook.extension);
      if (retained.length > 0) config.hooks.lifecycle[event] = retained;
      else delete config.hooks.lifecycle[event];
    }
  }
  if (policy.extensionTrustRoots) {
    config.security.extensionTrustRoots = structuredClone(
      policy.extensionTrustRoots,
    );
  }
  if (policy.requireSignedAcpRegistry) {
    config.security.requireSignedAcpRegistry = true;
  }
  if (policy.acpRegistryTrustRoots) {
    config.security.acpRegistryTrustRoots = structuredClone(
      policy.acpRegistryTrustRoots,
    );
  }
  if (policy.windowsSandboxTrustRoots) {
    config.security.windowsSandboxTrustRoots = structuredClone(
      policy.windowsSandboxTrustRoots,
    );
  }
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
    disableExternalAgents: policy.disableExternalAgents,
    disableExtensionHooks: policy.disableExtensionHooks,
    disableExtensionTools: policy.disableExtensionTools,
    allowedExtensions: policy.allowedExtensions,
    extensionTrustRoots: policy.extensionTrustRoots,
    requireSignedAcpRegistry: policy.requireSignedAcpRegistry,
    acpRegistryTrustRoots: policy.acpRegistryTrustRoots,
    windowsSandboxTrustRoots: policy.windowsSandboxTrustRoots,
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
