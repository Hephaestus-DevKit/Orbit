import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { resolveSafePath } from "@orbit-build/shared";
import { SessionStore } from "./SessionStore.js";
import { SessionIdSchema, type Session } from "./types.js";

const MAX_SCAN_ENTRIES = 100_000;
const MAX_SCAN_BYTES = 2 * 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Local retention constraints. At least one of the three limits is required. */
export const SessionRetentionPolicySchema = z
  .object({
    olderThanDays: z.number().int().min(1).max(3_650).optional(),
    maxSessions: z.number().int().min(1).max(100_000).optional(),
    maxBytes: z.number().int().positive().max(MAX_SCAN_BYTES).optional(),
    keepActive: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) =>
      value.olderThanDays !== undefined ||
      value.maxSessions !== undefined ||
      value.maxBytes !== undefined,
    { message: "At least one retention limit is required." },
  );

export type SessionRetentionPolicy = z.infer<
  typeof SessionRetentionPolicySchema
>;

export const SessionRetentionCandidateSchema = z.object({
  id: SessionIdSchema,
  status: z.enum(["active", "completed", "failed", "aborted"]),
  updatedAt: z.string().datetime(),
  bytes: z.number().int().nonnegative().max(MAX_SCAN_BYTES),
  reasons: z
    .array(z.enum(["age", "count", "size"]))
    .min(1)
    .max(3),
});

export type SessionRetentionCandidate = z.infer<
  typeof SessionRetentionCandidateSchema
>;

export interface SessionRetentionPlan {
  schemaVersion: 1;
  workspaceId: string;
  generatedAt: string;
  policy: SessionRetentionPolicy;
  totalSessions: number;
  totalBytes: number;
  protectedActiveSessions: number;
  candidates: SessionRetentionCandidate[];
  warnings: string[];
}

export interface SessionRetentionApplyResult {
  schemaVersion: 1;
  applied: boolean;
  deleted: string[];
  skipped: Array<{ id: string; reason: "changed" | "active" | "missing" }>;
  plan: SessionRetentionPlan;
}

interface ScannedSession {
  session: Session;
  bytes: number;
  scanError?: string;
}

/** Build a bounded, deterministic retention plan without deleting anything. */
export function planSessionRetention(
  cwd: string,
  rawPolicy: SessionRetentionPolicy,
  now = new Date(),
): SessionRetentionPlan {
  const policy = SessionRetentionPolicySchema.parse(rawPolicy);
  const workspace = resolve(cwd);
  const store = new SessionStore(workspace);
  const sessions = store.listSessions();
  const warnings: string[] = [];
  const scanned = sessions.map((session) => {
    try {
      return {
        session,
        bytes: measureSessionDirectory(workspace, session.id),
      } satisfies ScannedSession;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Unable to measure ${session.id}: ${message}`);
      return { session, bytes: 0, scanError: message } satisfies ScannedSession;
    }
  });
  const totalBytes = scanned.reduce((sum, item) => sum + item.bytes, 0);
  const protectedActiveSessions = scanned.filter(
    (item) => policy.keepActive && item.session.status === "active",
  ).length;
  const candidates = new Map<
    string,
    { item: ScannedSession; reasons: Set<"age" | "count" | "size"> }
  >();
  const canDelete = (item: ScannedSession): boolean =>
    !item.scanError && !(policy.keepActive && item.session.status === "active");
  const addCandidate = (
    item: ScannedSession,
    reason: "age" | "count" | "size",
  ): void => {
    if (!canDelete(item)) return;
    const current = candidates.get(item.session.id);
    if (current) current.reasons.add(reason);
    else candidates.set(item.session.id, { item, reasons: new Set([reason]) });
  };

  if (policy.olderThanDays !== undefined) {
    const cutoff = now.getTime() - policy.olderThanDays * DAY_MS;
    for (const item of scanned) {
      if (Date.parse(item.session.updatedAt) < cutoff)
        addCandidate(item, "age");
    }
  }

  if (policy.maxSessions !== undefined && scanned.length > policy.maxSessions) {
    for (const item of scanned.slice(policy.maxSessions))
      addCandidate(item, "count");
  }

  if (policy.maxBytes !== undefined && totalBytes > policy.maxBytes) {
    let remaining = totalBytes;
    for (const item of [...scanned].reverse()) {
      if (remaining <= policy.maxBytes) break;
      if (!canDelete(item)) continue;
      addCandidate(item, "size");
      remaining -= item.bytes;
    }
    if (remaining > policy.maxBytes) {
      warnings.push(
        `Retention limit remains above maxBytes because protected or unreadable sessions cannot be deleted (${remaining} bytes remain).`,
      );
    }
  }

  const ordered = [...candidates.values()]
    .sort(
      (a, b) =>
        Date.parse(a.item.session.updatedAt) -
        Date.parse(b.item.session.updatedAt),
    )
    .map(({ item, reasons }) =>
      SessionRetentionCandidateSchema.parse({
        id: item.session.id,
        status: item.session.status,
        updatedAt: item.session.updatedAt,
        bytes: item.bytes,
        reasons: [...reasons],
      }),
    );

  return {
    schemaVersion: 1,
    workspaceId: createHash("sha256")
      .update(workspace)
      .digest("hex")
      .slice(0, 16),
    generatedAt: now.toISOString(),
    policy,
    totalSessions: sessions.length,
    totalBytes,
    protectedActiveSessions,
    candidates: ordered,
    warnings,
  };
}

/**
 * Apply a previously reviewed plan after re-planning and comparing every
 * candidate's updatedAt and byte count. Changed, active, or missing sessions
 * are skipped instead of being force-deleted.
 */
export function applySessionRetention(
  cwd: string,
  plan: SessionRetentionPlan,
): SessionRetentionApplyResult {
  const workspace = resolve(cwd);
  const currentPlan = planSessionRetention(
    workspace,
    plan.policy,
    new Date(plan.generatedAt),
  );
  if (currentPlan.workspaceId !== plan.workspaceId) {
    throw new Error("Retention plan belongs to a different workspace.");
  }
  const currentById = new Map(
    currentPlan.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const currentSessions = new Map(
    new SessionStore(workspace)
      .listSessions()
      .map((session) => [session.id, session]),
  );
  const deleted: string[] = [];
  const skipped: SessionRetentionApplyResult["skipped"] = [];
  const store = new SessionStore(workspace);
  for (const candidate of plan.candidates) {
    const session = currentSessions.get(candidate.id);
    if (!session) {
      skipped.push({ id: candidate.id, reason: "missing" });
      continue;
    }
    if (plan.policy.keepActive && session.status === "active") {
      skipped.push({ id: candidate.id, reason: "active" });
      continue;
    }
    const current = currentById.get(candidate.id);
    if (
      !current ||
      current.updatedAt !== candidate.updatedAt ||
      current.bytes !== candidate.bytes
    ) {
      skipped.push({ id: candidate.id, reason: "changed" });
      continue;
    }
    store.deleteSession(candidate.id);
    deleted.push(candidate.id);
  }
  return {
    schemaVersion: 1,
    applied: true,
    deleted,
    skipped,
    plan: currentPlan,
  };
}

function measureSessionDirectory(cwd: string, sessionId: string): number {
  const validId = SessionIdSchema.parse(sessionId);
  const root = resolveSafePath(cwd, join(".orbit", "sessions", validId));
  if (!existsSync(root)) return 0;
  const stats = lstatSync(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("session directory must be a real directory");
  }
  let entries = 0;
  let bytes = 0;
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      entries += 1;
      if (entries > MAX_SCAN_ENTRIES)
        throw new Error("session tree is too large");
      const path = join(directory, name);
      const child = lstatSync(path);
      if (child.isSymbolicLink())
        throw new Error("session tree contains a symbolic link");
      if (child.isDirectory()) {
        visit(path);
      } else if (child.isFile()) {
        const size = child.size;
        bytes += size;
        if (bytes > MAX_SCAN_BYTES)
          throw new Error("session tree exceeds byte limit");
      }
    }
  };
  visit(root);
  return bytes;
}

/** Human-readable relative path for retention diagnostics. */
export function retentionPath(cwd: string, sessionId: string): string {
  const validId = SessionIdSchema.parse(sessionId);
  const root = resolveSafePath(
    resolve(cwd),
    join(".orbit", "sessions", validId),
  );
  return relative(resolve(cwd), root).split(sep).join("/");
}
