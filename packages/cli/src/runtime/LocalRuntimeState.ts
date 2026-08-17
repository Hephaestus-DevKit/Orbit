import { z } from "zod";
import {
  MAX_AGENT_MAX_ITERATIONS,
  OrbitLanguageSchema,
} from "@orbit-build/config";
import {
  readBoundedRegularFile,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";

const LOCAL_RUNTIME_STATE_MAX_BYTES = 1_048_576;

const LocalSkillsStateSchema = z.object({
  enabled: z.boolean().optional(),
  activation: z.enum(["auto", "explicit"]).optional(),
  maxActive: z.number().int().min(0).max(8).optional(),
  disabled: z.array(z.string().min(1).max(128)).max(1_000).optional(),
});

export const LocalRuntimeStateSchema = z.object({
  lastSessionId: z.string().min(1).max(1_000).optional(),
  lastProvider: z.string().min(1).max(256).optional(),
  lastModel: z.string().max(512).optional(),
  language: OrbitLanguageSchema.optional(),
  permissionMode: z.enum(["strict", "normal", "auto", "plan"]).optional(),
  agentMaxIterations: z
    .number()
    .int()
    .min(1)
    .max(MAX_AGENT_MAX_ITERATIONS)
    .optional(),
  agentProfile: z
    .string()
    .max(64)
    .regex(/^$|^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  skills: LocalSkillsStateSchema.optional(),
});

export type LocalRuntimeState = z.infer<typeof LocalRuntimeStateSchema>;

/** Read bounded, validated project-local UI state without following symlinks. */
export function readLocalRuntimeState(cwd: string): LocalRuntimeState {
  try {
    const statePath = resolveSafePath(cwd, ".orbit/state.json");
    const raw = readBoundedRegularFile(
      statePath,
      LOCAL_RUNTIME_STATE_MAX_BYTES,
    );
    if (raw === undefined) return {};
    const parsed = LocalRuntimeStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Merge and atomically replace project-local UI state.
 * Throws when the state path is unsafe or the commit cannot be completed.
 */
export function writeLocalRuntimeState(
  cwd: string,
  patch: LocalRuntimeState,
): void {
  const statePath = resolveSafePath(cwd, ".orbit/state.json");
  const updated = LocalRuntimeStateSchema.parse({
    ...readLocalRuntimeState(cwd),
    ...patch,
  });
  replacePrivateFileAtomically(
    statePath,
    `${JSON.stringify(updated, null, 2)}\n`,
  );
}
