import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "crypto";
import { z } from "zod";
import { canonicalJsonStringify } from "@orbit-build/shared";

export const FleetJobIdSchema = z.string().regex(/^job_[a-f0-9]{32}$/);
export type FleetJobId = z.infer<typeof FleetJobIdSchema>;

export const FleetWorkerIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
export type FleetWorkerId = z.infer<typeof FleetWorkerIdSchema>;

export const FleetJobStateSchema = z.enum([
  "queued",
  "leased",
  "succeeded",
  "failed",
  "canceled",
  "expired",
]);
export type FleetJobState = z.infer<typeof FleetJobStateSchema>;

export const FleetPatchSchema = z
  .object({
    baseRevision: z.string().regex(/^[A-Za-z0-9._:/-]{1,256}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    files: z
      .array(
        z
          .string()
          .regex(
            /^(?!\.\.?\/?)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._~+@%=-]+(?:[\\/][A-Za-z0-9._~+@%=-]+)*$/,
          ),
      )
      .max(2_000),
    ownership: z
      .object({
        ownerId: FleetWorkerIdSchema,
        scope: z.array(z.string().min(1).max(512)).min(1).max(200),
      })
      .strict(),
  })
  .strict();
export type FleetPatch = z.infer<typeof FleetPatchSchema>;

export const FleetJobRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: FleetJobIdSchema,
    originId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    workspaceRef: z.string().regex(/^[A-Za-z0-9._:/-]{1,256}$/),
    prompt: z.string().trim().min(1).max(100_000),
    state: FleetJobStateSchema,
    attempt: z.number().int().min(1).max(20),
    maxAttempts: z.number().int().min(1).max(20),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lease: z
      .object({
        workerId: FleetWorkerIdSchema,
        leaseId: z.string().regex(/^lease_[a-f0-9]{32}$/),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    patch: FleetPatchSchema.optional(),
    resultDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    error: z.string().max(4_000).optional(),
  })
  .strict();
export type FleetJobRecord = z.infer<typeof FleetJobRecordSchema>;

export const FleetJobSubmitSchema = z
  .object({
    originId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    workspaceRef: z.string().regex(/^[A-Za-z0-9._:/-]{1,256}$/),
    prompt: z.string().trim().min(1).max(100_000),
    maxAttempts: z.number().int().min(1).max(20).default(3),
  })
  .strict();
export type FleetJobSubmit = z.input<typeof FleetJobSubmitSchema>;

export const FleetSignedEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    job: FleetJobSubmitSchema,
    jobId: FleetJobIdSchema,
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    signerId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{80,512}$/),
  })
  .strict();
export type FleetSignedEnvelope = z.infer<typeof FleetSignedEnvelopeSchema>;

export function createFleetJobId(randomBytes: Uint8Array): FleetJobId {
  const hex = Buffer.from(randomBytes).toString("hex").slice(0, 32);
  if (hex.length !== 32) throw new Error("Fleet job entropy is too short.");
  return `job_${hex}`;
}

export function signFleetEnvelope(
  job: FleetJobSubmit,
  jobId: FleetJobId,
  signerId: string,
  privateKey: string | Buffer,
): FleetSignedEnvelope {
  const parsedJob = FleetJobSubmitSchema.parse(job);
  const payload = canonicalJsonStringify({
    schemaVersion: 1,
    jobId,
    job: parsedJob,
    signerId,
  });
  const payloadDigest = createHash("sha256")
    .update(payload, "utf8")
    .digest("hex");
  const signature = sign(
    null,
    Buffer.from(payload, "utf8"),
    createPrivateKey(privateKey),
  ).toString("base64url");
  return FleetSignedEnvelopeSchema.parse({
    schemaVersion: 1,
    job: parsedJob,
    jobId,
    payloadDigest,
    signerId,
    signature,
  });
}

export function verifyFleetEnvelope(
  envelope: FleetSignedEnvelope,
  publicKey: string | Buffer,
): boolean {
  const parsed = FleetSignedEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) return false;
  const payload = canonicalJsonStringify({
    schemaVersion: 1,
    jobId: parsed.data.jobId,
    job: parsed.data.job,
    signerId: parsed.data.signerId,
  });
  const digest = createHash("sha256").update(payload, "utf8").digest("hex");
  if (digest !== parsed.data.payloadDigest) return false;
  try {
    return verify(
      null,
      Buffer.from(payload, "utf8"),
      createPublicKey(publicKey),
      Buffer.from(parsed.data.signature, "base64url"),
    );
  } catch {
    return false;
  }
}
