import { z } from "zod";
import {
  FleetJobIdSchema,
  FleetJobRecordSchema,
  FleetJobSubmitSchema,
  FleetPatchSchema,
  FleetSignedEnvelopeSchema,
  FleetWorkerIdSchema,
} from "./FleetProtocol.js";

export const FLEET_HTTP_PROTOCOL_VERSION = 1 as const;
export const MAX_FLEET_HTTP_BODY_BYTES = 1 * 1024 * 1024;
export const MAX_FLEET_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;

export const FleetHttpScopeSchema = z.enum([
  "read",
  "submit",
  "worker",
  "control",
  "admin",
]);
export type FleetHttpScope = z.infer<typeof FleetHttpScopeSchema>;

export const FleetHttpPrincipalSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/),
    token: z.string().min(32).max(256),
    scopes: z.array(FleetHttpScopeSchema).min(1).max(5),
    /** Optional worker identity binding for least-privilege worker tokens. */
    workerIds: z.array(FleetWorkerIdSchema).min(1).max(128).optional(),
  })
  .strict();
export type FleetHttpPrincipal = z.infer<typeof FleetHttpPrincipalSchema>;

export const FleetClaimRequestSchema = z
  .object({ workerId: FleetWorkerIdSchema })
  .strict();
export type FleetClaimRequest = z.infer<typeof FleetClaimRequestSchema>;

export const FleetLeaseRequestSchema = z
  .object({
    workerId: FleetWorkerIdSchema,
    leaseId: z.string().regex(/^lease_[a-f0-9]{32}$/),
  })
  .strict();
export type FleetLeaseRequest = z.infer<typeof FleetLeaseRequestSchema>;

export const FleetCompletionRequestSchema = z
  .object({
    workerId: FleetWorkerIdSchema,
    leaseId: z.string().regex(/^lease_[a-f0-9]{32}$/),
    completion: z
      .object({
        state: z.enum(["succeeded", "failed"]),
        resultDigest: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        patch: FleetPatchSchema.optional(),
        error: z.string().max(4_000).optional(),
      })
      .strict(),
  })
  .strict();
export type FleetCompletionRequest = z.infer<
  typeof FleetCompletionRequestSchema
>;

export const FleetSignedSubmitRequestSchema = FleetSignedEnvelopeSchema;
export type FleetSignedSubmitRequest = z.infer<
  typeof FleetSignedSubmitRequestSchema
>;

export const FleetJobListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const FleetHttpErrorSchema = z
  .object({
    schemaVersion: z.literal(FLEET_HTTP_PROTOCOL_VERSION),
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().regex(/^[a-z][a-z0-9_:-]{0,63}$/),
        message: z.string().max(4_000),
      })
      .strict(),
  })
  .strict();
export type FleetHttpError = z.infer<typeof FleetHttpErrorSchema>;

export const FleetHealthResponseSchema = z
  .object({
    schemaVersion: z.literal(FLEET_HTTP_PROTOCOL_VERSION),
    ok: z.literal(true),
    protocolVersion: z.literal(FLEET_HTTP_PROTOCOL_VERSION),
    accepting: z.boolean(),
    jobs: z.number().int().nonnegative().max(10_000),
  })
  .strict();

export const FleetJobResponseSchema = z
  .object({
    schemaVersion: z.literal(FLEET_HTTP_PROTOCOL_VERSION),
    ok: z.literal(true),
    job: FleetJobRecordSchema,
  })
  .strict();

export const FleetJobListResponseSchema = z
  .object({
    schemaVersion: z.literal(FLEET_HTTP_PROTOCOL_VERSION),
    ok: z.literal(true),
    jobs: z.array(FleetJobRecordSchema).max(500),
  })
  .strict();

export const FleetClaimResponseSchema = FleetJobResponseSchema;

export function assertFleetJobId(
  value: string,
): z.infer<typeof FleetJobIdSchema> {
  return FleetJobIdSchema.parse(value);
}

export type FleetJobSubmitInput = z.input<typeof FleetJobSubmitSchema>;
