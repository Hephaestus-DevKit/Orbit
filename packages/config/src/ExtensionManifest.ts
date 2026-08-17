import { extname } from "path";
import { createPublicKey, verify as verifySignature } from "crypto";
import { readBoundedRegularFile, resolveSafePath } from "@orbit-build/shared";
import { canonicalJsonStringify } from "@orbit-build/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { McpServerConfigBaseSchema } from "./schema.js";

export const ORBIT_EXTENSION_MANIFEST_VERSION = 1 as const;
const MAX_MANIFEST_BYTES = 1024 * 1024;

const SemverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const ContributionNameSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const CredentialEnvironmentNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);
const RelativeContributionPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) &&
      !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value),
    "Contribution paths must remain inside the extension directory.",
  );

const NamedContributionSchema = z.object({
  name: ContributionNameSchema,
  path: RelativeContributionPathSchema,
  description: z.string().trim().min(1).max(500).optional(),
});

export const ExtensionPermissionSchema = z.object({
  filesystem: z
    .array(
      z.object({
        mode: z.enum(["read", "write"]),
        scope: RelativeContributionPathSchema.or(z.literal("*")),
      }),
    )
    .max(128)
    .default([]),
  network: z
    .array(
      z
        .string()
        .min(1)
        .max(253)
        .regex(
          /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/,
          "Expected a hostname without a URL scheme, path, or credentials.",
        ),
    )
    .max(128)
    .default([]),
  process: z.boolean().default(false),
  credentials: z.array(CredentialEnvironmentNameSchema).max(64).default([]),
});

export const OrbitExtensionManifestSchema = z.object({
  schemaVersion: z.literal(ORBIT_EXTENSION_MANIFEST_VERSION),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/),
  displayName: z.string().trim().min(1).max(200),
  version: SemverSchema,
  signature: z
    .object({
      algorithm: z.literal("ed25519"),
      keyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
      value: z.string().base64().max(16_384),
    })
    .optional(),
  description: z.string().trim().max(2000).optional(),
  orbit: z.object({
    minVersion: SemverSchema,
    maxVersion: SemverSchema.optional(),
  }),
  permissions: ExtensionPermissionSchema.default({}),
  contributes: z
    .object({
      commands: z.array(NamedContributionSchema).max(200).default([]),
      skills: z.array(NamedContributionSchema).max(200).default([]),
      agents: z.array(NamedContributionSchema).max(100).default([]),
      tools: z
        .array(
          NamedContributionSchema.extend({
            risk: z.enum(["read", "write", "execute", "dangerous", "network"]),
          }),
        )
        .max(200)
        .default([]),
      hooks: z
        .array(
          z.object({
            event: z.enum([
              "session_start",
              "prompt_submit",
              "permission_request",
              "pre_tool",
              "post_tool",
              "post_tool_failure",
              "pre_compact",
              "post_compact",
              "verification_start",
              "verification_end",
              "agent_start",
              "agent_end",
              "subagent_stop",
              "session_stop",
            ]),
            command: z.string().trim().min(1).max(4000),
            matcher: z.string().trim().min(1).max(256).optional(),
            timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
            onFailure: z.enum(["block", "warn", "ignore"]).default("warn"),
          }),
        )
        .max(100)
        .default([]),
      mcpServers: z
        .record(McpServerConfigBaseSchema.omit({ env: true }))
        .default({}),
      templates: z.array(NamedContributionSchema).max(200).default([]),
    })
    .default({}),
});

export type OrbitExtensionManifest = z.infer<
  typeof OrbitExtensionManifestSchema
>;

/** Verify a signed extension manifest and its immutable tree digest. */
export function verifyOrbitExtensionSignature(
  manifest: OrbitExtensionManifest,
  digest: string,
  trustRoots: Record<string, string>,
): boolean {
  const signature = manifest.signature;
  if (!signature) return false;
  const publicKey = trustRoots[signature.keyId];
  if (!publicKey) return false;
  const unsignedManifest = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "signature"),
  );
  const payload = canonicalJsonStringify({
    manifest: unsignedManifest,
    digest,
  });
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

/** Load one non-symlinked manifest from inside the current workspace. */
export function loadOrbitExtensionManifest(
  cwd: string,
  manifestPath: string,
): OrbitExtensionManifest {
  const resolved = resolveSafePath(cwd, manifestPath);
  const text = readBoundedRegularFile(resolved, MAX_MANIFEST_BYTES);
  if (text === undefined)
    throw new Error("Orbit extension manifest not found.");
  const raw =
    extname(resolved).toLowerCase() === ".json"
      ? JSON.parse(text)
      : parseYaml(text);
  return OrbitExtensionManifestSchema.parse(raw);
}
