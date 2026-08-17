import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { homedir } from "node:os";
import { existsSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { ExternalAgentConfigSchema } from "@orbit-build/config";
import {
  canonicalJsonStringify,
  readBoundedRegularFile,
  redactSecrets,
} from "@orbit-build/shared";

type ExternalAgentConfig = z.infer<typeof ExternalAgentConfigSchema>;

const MAX_REGISTRY_BYTES = 512 * 1024;
const MAX_REGISTRY_ENTRIES = 100;

const RegistryIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/, "Invalid ACP registry id.");

const AcpRegistrySignatureSchema = z.object({
  algorithm: z.literal("ed25519"),
  keyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  value: z.string().base64().max(16_384),
});

export const AcpRegistrySignatureStatusSchema = z.enum([
  "unsigned",
  "valid",
  "untrusted-key",
  "invalid",
]);
export type AcpRegistrySignatureStatus = z.infer<
  typeof AcpRegistrySignatureStatusSchema
>;

/** A discoverable ACP manifest; discovery never grants execution trust. */
export const AcpRegistryEntrySchema = z
  .object({
    id: RegistryIdSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).optional(),
    command: z.string().trim().min(1).max(4_096),
    args: z.array(z.string().max(20_000)).max(200).default([]),
    enabled: z.boolean().default(true),
    requestTimeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(600_000),
    permissionPolicy: z.enum(["ask", "deny"]).default("ask"),
    trust: z.enum(["untrusted", "trusted"]).default("untrusted"),
  })
  .strict();

export type AcpRegistryEntry = z.infer<typeof AcpRegistryEntrySchema>;

/** Signed hosted-registry provenance and monotonic revision metadata. */
export const AcpRegistryMetadataSchema = z
  .object({
    registryId: RegistryIdSchema,
    owner: z.string().trim().min(1).max(256),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type AcpRegistryMetadata = z.infer<typeof AcpRegistryMetadataSchema>;

export const AcpRegistryFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    agents: z.array(AcpRegistryEntrySchema).max(MAX_REGISTRY_ENTRIES),
    metadata: AcpRegistryMetadataSchema.optional(),
    signature: AcpRegistrySignatureSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.agents.forEach((agent, index) => {
      if (ids.has(agent.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents", index, "id"],
          message: `Duplicate ACP registry id: ${agent.id}`,
        });
      }
      ids.add(agent.id);
    });
  });

export type AcpRegistryFile = z.infer<typeof AcpRegistryFileSchema>;

export interface AcpRegistryEntrySnapshot {
  entry: AcpRegistryEntry;
  scope: "project" | "user";
  path: string;
  digest: string;
  signatureStatus: AcpRegistrySignatureStatus;
}

export interface AcpRegistryDiagnostic {
  scope: "project" | "user";
  path: string;
  ok: boolean;
  signatureStatus?: AcpRegistrySignatureStatus;
  error?: string;
}

export interface AcpRegistrySnapshot {
  schemaVersion: 1;
  entries: AcpRegistryEntrySnapshot[];
  diagnostics: AcpRegistryDiagnostic[];
}

export interface AcpRegistryLoadOptions {
  /** Ed25519 public keys keyed by the signature's stable key id. */
  trustRoots?: Record<string, string>;
  /** Reject unsigned or unverifiable registry files during discovery. */
  requireSignature?: boolean;
}

/** Build the stable unsigned document, digest, and signature payload. */
export function buildAcpRegistrySignaturePayload(file: AcpRegistryFile): {
  digest: string;
  payload: string;
} {
  const unsigned = {
    schemaVersion: file.schemaVersion,
    agents: file.agents,
    ...(file.metadata ? { metadata: file.metadata } : {}),
  };
  const digest = createHash("sha256")
    .update(canonicalJsonStringify(unsigned), "utf8")
    .digest("hex");
  return {
    digest,
    payload: canonicalJsonStringify({ registry: unsigned, digest }),
  };
}

/** Verify a registry signature against configured Ed25519 trust roots. */
export function verifyAcpRegistrySignature(
  file: AcpRegistryFile,
  trustRoots: Record<string, string>,
): boolean {
  const signature = file.signature;
  if (!signature) return false;
  const publicKey = trustRoots[signature.keyId];
  if (!publicKey) return false;
  const { payload } = buildAcpRegistrySignaturePayload(file);
  try {
    return verifySignature(
      null,
      Buffer.from(payload, "utf8"),
      createPublicKey(publicKey),
      Buffer.from(signature.value, "base64"),
    );
  } catch {
    return false;
  }
}

function registrySignatureStatus(
  file: AcpRegistryFile,
  trustRoots: Record<string, string>,
): AcpRegistrySignatureStatus {
  if (!file.signature) return "unsigned";
  if (!trustRoots[file.signature.keyId]) return "untrusted-key";
  return verifyAcpRegistrySignature(file, trustRoots) ? "valid" : "invalid";
}

/**
 * Load the bounded, local ACP registry from user and project scopes.
 * Project entries override user entries with the same id. No command is
 * spawned and `trust: trusted` is reported, not inferred or granted here.
 */
export function loadAcpRegistry(
  cwd: string,
  homeDirectory = homedir(),
  options: AcpRegistryLoadOptions = {},
): AcpRegistrySnapshot {
  const projectRoot = resolve(cwd);
  const candidates: Array<{
    scope: "project" | "user";
    path: string;
  }> = [
    {
      scope: "user",
      path: join(resolve(homeDirectory), ".orbit", "acp", "registry.json"),
    },
    {
      scope: "project",
      path: join(projectRoot, ".orbit", "acp", "registry.json"),
    },
  ];
  const diagnostics: AcpRegistryDiagnostic[] = [];
  const byId = new Map<string, AcpRegistryEntrySnapshot>();

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    let observedSignatureStatus: AcpRegistrySignatureStatus | undefined;
    try {
      const stats = lstatSync(candidate.path);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error("registry must be a regular, non-symlink file");
      }
      const raw = readBoundedRegularFile(candidate.path, MAX_REGISTRY_BYTES, {
        allowSymbolicLink: false,
      });
      if (raw === undefined)
        throw new Error("registry file is empty or unreadable");
      const parsed = AcpRegistryFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues.map((issue) => issue.message).join("; "),
        );
      }
      const signatureStatus = registrySignatureStatus(
        parsed.data,
        options.trustRoots ?? {},
      );
      observedSignatureStatus = signatureStatus;
      if (
        signatureStatus === "invalid" ||
        signatureStatus === "untrusted-key" ||
        (options.requireSignature && signatureStatus !== "valid")
      ) {
        throw new Error(
          options.requireSignature
            ? `registry signature is ${signatureStatus}; a valid trusted signature is required`
            : `registry signature is ${signatureStatus}`,
        );
      }
      const { digest } = buildAcpRegistrySignaturePayload(parsed.data);
      for (const entry of parsed.data.agents) {
        byId.set(entry.id, {
          entry,
          scope: candidate.scope,
          path: candidate.path,
          digest,
          signatureStatus,
        });
      }
      diagnostics.push({ ...candidate, ok: true, signatureStatus });
    } catch (error: unknown) {
      diagnostics.push({
        ...candidate,
        ok: false,
        ...(observedSignatureStatus
          ? { signatureStatus: observedSignatureStatus }
          : {}),
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 2_000),
      });
    }
  }

  return {
    schemaVersion: 1,
    entries: [...byId.values()].sort((a, b) =>
      a.entry.id.localeCompare(b.entry.id),
    ),
    diagnostics,
  };
}

/** Convert an explicitly trusted registry entry to the runtime config shape. */
export function toTrustedExternalAgentConfig(
  snapshot: AcpRegistryEntrySnapshot,
  options: { requireSignature?: boolean } = {},
): ExternalAgentConfig {
  if (snapshot.entry.trust !== "trusted") {
    throw new Error(`ACP registry entry ${snapshot.entry.id} is not trusted.`);
  }
  if (options.requireSignature && snapshot.signatureStatus !== "valid") {
    throw new Error(
      `ACP registry entry ${snapshot.entry.id} does not have a valid trusted signature.`,
    );
  }
  return ExternalAgentConfigSchema.parse({
    command: snapshot.entry.command,
    args: snapshot.entry.args,
    enabled: snapshot.entry.enabled,
    requestTimeoutMs: snapshot.entry.requestTimeoutMs,
    permissionPolicy: snapshot.entry.permissionPolicy,
  });
}
