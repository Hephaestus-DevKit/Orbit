import { createHash } from "crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  fsyncSync,
  openSync,
  statSync,
} from "fs";
import { dirname, resolve } from "path";
import { z } from "zod";
import {
  canonicalJsonStringify,
  ensurePrivateDirectory,
  redactSecrets,
  resolveSafePath,
} from "@orbit-build/shared";

const MAX_AUDIT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_AUDIT_ENTRIES = 100_000;
const MAX_METADATA_KEYS = 64;
const MAX_METADATA_VALUE_CHARS = 2_000;

export const DaemonAuditOutcomeSchema = z.enum([
  "accepted",
  "denied",
  "failed",
]);
export type DaemonAuditOutcome = z.infer<typeof DaemonAuditOutcomeSchema>;

export const DaemonAuditEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^audit_[a-f0-9]{32}$/),
    timestamp: z.string().datetime(),
    principalId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/),
    authMethod: z.string().regex(/^[a-z][a-z0-9._:-]{0,63}$/),
    action: z.string().regex(/^[a-z][a-z0-9._:-]{0,127}$/),
    outcome: DaemonAuditOutcomeSchema,
    requestId: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .optional(),
    taskId: z
      .string()
      .regex(/^task_[a-f0-9]{24,64}$/)
      .optional(),
    metadata: z
      .record(z.string(), z.string().max(MAX_METADATA_VALUE_CHARS))
      .superRefine((value, context) => {
        if (Object.keys(value).length > MAX_METADATA_KEYS) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Audit metadata has too many keys.",
          });
        }
      })
      .default({}),
    previousDigest: z.string().regex(/^[a-f0-9]{64}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type DaemonAuditEntry = z.infer<typeof DaemonAuditEntrySchema>;

export interface DaemonAuditInput {
  principalId: string;
  authMethod: string;
  action: string;
  outcome: DaemonAuditOutcome;
  requestId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export interface DaemonAuditVerification {
  valid: boolean;
  entries: number;
  lastDigest: string;
  error?: string;
}

/**
 * Bounded, append-only, hash-chained daemon audit storage.
 *
 * This is deliberately local and provider-neutral. It gives operators a
 * tamper-evident export primitive; forwarding to a central SIEM remains an
 * explicit, authenticated integration owned by the deployment.
 */
export class DaemonAuditLog {
  private initialized = false;
  private entries = 0;
  private lastDigest = "0".repeat(64);

  public constructor(
    private readonly filePath: string,
    private readonly rootDirectory?: string,
  ) {}

  public initialize(): DaemonAuditVerification {
    if (this.initialized) return this.verify();
    const path = this.resolveFilePath();
    ensurePrivateDirectory(dirname(path));
    this.assertRegularPath(path);
    if (!existsSync(path)) {
      this.initialized = true;
      return { valid: true, entries: 0, lastDigest: this.lastDigest };
    }
    const stat = statSync(path);
    if (stat.size > MAX_AUDIT_FILE_BYTES) {
      throw new Error(
        `Daemon audit log exceeds ${MAX_AUDIT_FILE_BYTES} bytes.`,
      );
    }
    const verification = this.verify();
    if (!verification.valid)
      throw new Error(
        verification.error ?? "Daemon audit log verification failed.",
      );
    this.entries = verification.entries;
    this.lastDigest = verification.lastDigest;
    this.initialized = true;
    return verification;
  }

  public append(input: DaemonAuditInput): DaemonAuditEntry {
    if (!this.initialized) this.initialize();
    const current = this.verify();
    if (
      !current.valid ||
      current.entries !== this.entries ||
      current.lastDigest !== this.lastDigest
    ) {
      throw new Error(
        current.error ?? "Daemon audit log changed outside this instance.",
      );
    }
    if (this.entries >= MAX_AUDIT_ENTRIES) {
      throw new Error(
        `Daemon audit retention limit reached (${MAX_AUDIT_ENTRIES}).`,
      );
    }
    const now = input.now ?? new Date();
    const base = {
      schemaVersion: 1 as const,
      id: `audit_${createHash("sha256")
        .update(`${now.toISOString()}\0${this.entries}\0${this.lastDigest}`)
        .digest("hex")
        .slice(0, 32)}`,
      timestamp: now.toISOString(),
      principalId: input.principalId,
      authMethod: input.authMethod,
      action: input.action,
      outcome: input.outcome,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      metadata: sanitizeMetadata(input.metadata),
      previousDigest: this.lastDigest,
    };
    const digest = createHash("sha256")
      .update(canonicalJsonStringify(base), "utf8")
      .digest("hex");
    const entry = DaemonAuditEntrySchema.parse({ ...base, digest });
    const serialized = `${JSON.stringify(entry)}\n`;
    if (
      Buffer.byteLength(serialized, "utf8") >
      MAX_METADATA_VALUE_CHARS * MAX_METADATA_KEYS
    ) {
      throw new Error("Daemon audit entry is too large.");
    }
    const descriptor = openSync(
      this.resolveFilePath(),
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
      0o600,
    );
    try {
      appendFileSync(descriptor, serialized, { encoding: "utf8" });
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    this.entries += 1;
    this.lastDigest = digest;
    return entry;
  }

  public read(limit = 500): DaemonAuditEntry[] {
    if (!this.initialized) this.initialize();
    const bounded = Math.max(1, Math.min(limit, MAX_AUDIT_ENTRIES));
    const raw = existsSync(this.resolveFilePath())
      ? readFileSync(this.resolveFilePath(), "utf8")
      : "";
    const rows = raw.split(/\r?\n/).filter(Boolean).slice(-bounded);
    return rows.map((row) => DaemonAuditEntrySchema.parse(JSON.parse(row)));
  }

  public verify(): DaemonAuditVerification {
    const path = this.resolveFilePath();
    if (!existsSync(path))
      return { valid: true, entries: 0, lastDigest: "0".repeat(64) };
    try {
      if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
        return {
          valid: false,
          entries: 0,
          lastDigest: "0".repeat(64),
          error: "Daemon audit log must be a regular file.",
        };
      }
      const stat = statSync(path);
      if (stat.size > MAX_AUDIT_FILE_BYTES) {
        return {
          valid: false,
          entries: 0,
          lastDigest: "0".repeat(64),
          error: "Daemon audit log exceeds its size limit.",
        };
      }
      const rows = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
      if (rows.length > MAX_AUDIT_ENTRIES) {
        return {
          valid: false,
          entries: rows.length,
          lastDigest: "0".repeat(64),
          error: "Daemon audit log exceeds its entry limit.",
        };
      }
      let previous = "0".repeat(64);
      for (let index = 0; index < rows.length; index += 1) {
        const entry = DaemonAuditEntrySchema.parse(JSON.parse(rows[index]));
        if (entry.previousDigest !== previous)
          throw new Error(`hash-chain break at entry ${index + 1}`);
        const { digest, ...base } = entry;
        const expected = createHash("sha256")
          .update(canonicalJsonStringify(base), "utf8")
          .digest("hex");
        if (digest !== expected)
          throw new Error(`digest mismatch at entry ${index + 1}`);
        previous = digest;
      }
      return { valid: true, entries: rows.length, lastDigest: previous };
    } catch (error: unknown) {
      return {
        valid: false,
        entries: 0,
        lastDigest: "0".repeat(64),
        error: redactSecrets(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }

  private resolveFilePath(): string {
    const base = this.rootDirectory
      ? resolve(this.rootDirectory)
      : process.cwd();
    const path = resolveSafePath(base, this.filePath);
    if (path === base) throw new Error("Daemon audit log path must be a file.");
    return path;
  }

  private assertRegularPath(path: string): void {
    const parent = dirname(path);
    mkdirSync(parent, { recursive: true });
    if (
      existsSync(path) &&
      (lstatSync(path).isSymbolicLink() || !statSync(path).isFile())
    ) {
      throw new Error("Daemon audit log must be a regular file.");
    }
  }
}

function sanitizeMetadata(
  input: Record<string, unknown> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {}).slice(
    0,
    MAX_METADATA_KEYS,
  )) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(key)) continue;
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    result[key] = redactSecrets(serialized ?? "null").slice(
      0,
      MAX_METADATA_VALUE_CHARS,
    );
  }
  return result;
}
