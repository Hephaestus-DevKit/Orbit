import { createHash, randomUUID } from "crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import {
  ensurePrivateDirectory,
  generateId,
  readBoundedRegularFile,
  resolveSafePath,
} from "@orbit-build/shared";
import {
  FileChangeRecordSchema,
  StoredHistorySchema,
  SessionEventSchema,
  SessionIdSchema,
  SessionMetricsSchema,
  RunJournalSchema,
  SessionSchema,
  SessionTraceBundleSchema,
  TaskPlanSchema,
  ToolCallRecordSchema,
} from "./types.js";
import type {
  FileChangeRecord,
  JsonValue,
  RunJournal,
  Session,
  SessionEvent,
  SessionMetrics,
  SessionTraceBundle,
  StoredHistoryMessage,
  TaskPlan,
  ToolCallRecord,
} from "./types.js";
import {
  redactAuditJson,
  redactAuditText,
  sanitizeAuditValue,
} from "./auditSerialization.js";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SESSION_SNAPSHOT_MAX_BYTES = 256 * 1024 * 1024;
const SESSION_LOG_MAX_BYTES = 256 * 1024 * 1024;
const SessionCreationInputSchema = SessionSchema.pick({
  provider: true,
  model: true,
});

interface SnapshotSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}

function readValidatedSnapshot<T>(
  filePath: string,
  schema: SnapshotSchema<T>,
): T | undefined {
  try {
    const raw = readBoundedRegularFile(filePath, SESSION_SNAPSHOT_MAX_BYTES);
    if (raw === undefined) return undefined;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeJsonAtomically<T>(
  filePath: string,
  value: T,
  schema: SnapshotSchema<T>,
): void {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error(`Unable to serialize JSON for ${filePath}.`);
  }

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryFd: number | undefined;
  try {
    temporaryFd = openSync(temporaryPath, "wx", PRIVATE_FILE_MODE);
    writeFileSync(temporaryFd, serialized, { encoding: "utf8" });
    fsyncSync(temporaryFd);
    closeSync(temporaryFd);
    temporaryFd = undefined;
    preserveLastKnownGoodFile(filePath, schema);
    replaceFileAtomically(temporaryPath, filePath);
    syncParentDirectory(filePath);
  } finally {
    if (temporaryFd !== undefined) {
      try {
        closeSync(temporaryFd);
      } catch {
        // The descriptor may already have been closed by a failed write.
      }
    }
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // A cleanup failure must not hide the original write/rename failure.
    }
  }
}

function syncParentDirectory(filePath: string): void {
  if (process.platform === "win32") return;
  let directoryFd: number | undefined;
  try {
    directoryFd = openSync(dirname(filePath), "r");
    fsyncSync(directoryFd);
  } catch {
    // Some filesystems do not support directory fsync. The file itself was
    // already flushed, so keep the portable fallback functional.
  } finally {
    if (directoryFd !== undefined) {
      try {
        closeSync(directoryFd);
      } catch {
        // Cleanup must not hide an otherwise successful durable write.
      }
    }
  }
}

function preserveLastKnownGoodFile<T>(
  filePath: string,
  schema: SnapshotSchema<T>,
): void {
  const previous = readValidatedSnapshot(filePath, schema);
  if (previous === undefined) return;
  const backupPath = `${filePath}.bak`;
  const temporaryBackupPath = `${backupPath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryBackupPath, "wx", PRIVATE_FILE_MODE);
    writeFileSync(descriptor, JSON.stringify(previous, null, 2), "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    replaceFileAtomically(temporaryBackupPath, backupPath);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original backup persistence failure.
      }
    }
    try {
      rmSync(temporaryBackupPath, { force: true });
    } catch {
      // Backup cleanup must not hide the primary persistence result.
    }
  }
}

function replaceFileAtomically(
  temporaryPath: string,
  destinationPath: string,
): void {
  try {
    renameSync(temporaryPath, destinationPath);
    return;
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "";
    if (!["EPERM", "EEXIST", "ENOTEMPTY"].includes(code)) throw error;
  }

  // Windows can reject rename-over-existing even after both handles are
  // closed. Rotate the previous file to a unique backup, install the complete
  // temp file, then remove the backup. Restore it if installation fails.
  const backupPath = `${destinationPath}.${process.pid}.${randomUUID()}.bak`;
  let previousMoved = false;
  try {
    if (existsSync(destinationPath)) {
      renameSync(destinationPath, backupPath);
      previousMoved = true;
    }
    renameSync(temporaryPath, destinationPath);
    if (previousMoved) {
      try {
        rmSync(backupPath, { force: true });
      } catch {
        // A stale backup is safer than failing an otherwise valid write.
      }
    }
  } catch (error: unknown) {
    if (
      previousMoved &&
      existsSync(backupPath) &&
      !existsSync(destinationPath)
    ) {
      try {
        renameSync(backupPath, destinationPath);
      } catch {
        // Preserve the replacement failure; the uniquely named backup remains
        // available for recovery.
      }
    }
    throw error;
  } finally {
    if (existsSync(destinationPath)) {
      try {
        rmSync(backupPath, { force: true });
      } catch {
        // Cleanup must not mask a successful replacement.
      }
    }
  }
}

function appendJsonLine(filePath: string, value: unknown): void {
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "a",
    mode: PRIVATE_FILE_MODE,
  });
}

function replaceWorkspacePath(text: string, cwd: string): string {
  const escaped = cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return redactAuditText(text).replace(
    new RegExp(escaped, process.platform === "win32" ? "gi" : "g"),
    "<workspace>",
  );
}

function stripWorkspacePaths(value: JsonValue, cwd: string): JsonValue {
  if (typeof value === "string") return replaceWorkspacePath(value, cwd);
  if (Array.isArray(value)) {
    return value.map((item) => stripWorkspacePaths(item, cwd));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        stripWorkspacePaths(item, cwd),
      ]),
    );
  }
  return value;
}

function sanitizeTraceJsonText(text: string, cwd: string): string {
  try {
    const value = sanitizeAuditValue(JSON.parse(text));
    return JSON.stringify(stripWorkspacePaths(value, cwd));
  } catch {
    return replaceWorkspacePath(text, cwd);
  }
}

function normalizeTracePath(filePath: string, cwd: string): string {
  const absolute = resolve(cwd, filePath);
  const relativePath = relative(cwd, absolute);
  if (
    relativePath &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  ) {
    return relativePath.split(sep).join("/");
  }
  return replaceWorkspacePath(filePath, cwd);
}

export class SessionStore {
  private readonly cwd: string;
  private readonly sessionRootPath: string;

  constructor(cwd: string, sessionRootPath = ".orbit/sessions") {
    this.cwd = resolve(cwd);
    this.sessionRootPath = sessionRootPath.trim();
  }

  public createSession(provider: string, model: string): Session {
    const creationInput = SessionCreationInputSchema.parse({ provider, model });
    const sessionRoot = this.resolveSessionRoot();
    ensurePrivateDirectory(sessionRoot);
    const { id, directory } = this.createUniqueSessionDirectory();
    const now = new Date().toISOString();
    const session = SessionSchema.parse({
      id,
      cwd: this.cwd,
      title: "New Orbit Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
      provider: creationInput.provider,
      model: creationInput.model,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostEstimate: 0,
    });

    try {
      writeJsonAtomically(
        join(directory, "session.json"),
        session,
        SessionSchema,
      );
    } catch (error: unknown) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }

    return session;
  }

  public getSession(id: string): Session | undefined {
    let sessionFile: string;
    try {
      sessionFile = join(this.resolveSessionDirectory(id), "session.json");
    } catch {
      return undefined;
    }
    if (!existsSync(sessionFile)) return undefined;
    for (const candidate of [sessionFile, `${sessionFile}.bak`]) {
      if (!existsSync(candidate)) continue;
      const parsed = readValidatedSnapshot(candidate, SessionSchema);
      if (parsed?.id === id) return parsed;
    }
    return undefined;
  }

  public updateSession(session: Session): void {
    const validated = SessionSchema.parse(session);
    const sessionFile = join(
      this.resolveSessionDirectory(validated.id),
      "session.json",
    );
    const updated = SessionSchema.parse({
      ...validated,
      updatedAt: new Date().toISOString(),
    });
    writeJsonAtomically(sessionFile, updated, SessionSchema);
  }

  public listSessions(): Session[] {
    let sessionRoot: string;
    let dirs: string[];
    try {
      sessionRoot = this.resolveSessionRoot();
      if (!existsSync(sessionRoot)) return [];
      dirs = readdirSync(sessionRoot);
    } catch {
      return [];
    }
    const sessions: Session[] = [];
    for (const dir of dirs) {
      const sess = this.getSession(dir);
      if (sess) sessions.push(sess);
    }
    return sessions.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }

  public appendEvent(
    sessionId: string,
    type: string,
    payload: unknown,
  ): SessionEvent {
    const event = SessionEventSchema.parse({
      id: generateId("evt"),
      sessionId,
      type,
      payload: sanitizeAuditValue(payload),
      createdAt: new Date().toISOString(),
    });

    const file = join(this.resolveSessionDirectory(sessionId), "events.jsonl");
    appendJsonLine(file, event);
    return event;
  }

  public getEvents(sessionId: string): SessionEvent[] {
    let file: string;
    try {
      file = join(this.resolveSessionDirectory(sessionId), "events.jsonl");
    } catch {
      return [];
    }
    if (!existsSync(file)) return [];
    let content: string;
    try {
      content = readBoundedRegularFile(file, SESSION_LOG_MAX_BYTES) ?? "";
    } catch {
      return [];
    }
    return content
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          const parsed = SessionEventSchema.safeParse(JSON.parse(line));
          return parsed.success && parsed.data.sessionId === sessionId
            ? [
                {
                  id: parsed.data.id,
                  sessionId: parsed.data.sessionId,
                  type: parsed.data.type,
                  payload: parsed.data.payload,
                  createdAt: parsed.data.createdAt,
                },
              ]
            : [];
        } catch {
          return [];
        }
      });
  }

  /** Returns a compact, local-only summary derived from the audit stream. */
  public getMetrics(sessionId: string): SessionMetrics {
    const events = this.getEvents(sessionId);
    const toolEvents = events.filter(
      (event) => event.type === "tool_execution",
    );
    const payloadStatus = (event: SessionEvent): string => {
      if (
        typeof event.payload === "object" &&
        event.payload !== null &&
        !Array.isArray(event.payload) &&
        typeof event.payload.status === "string"
      ) {
        return event.payload.status;
      }
      return "";
    };
    const payloadLane = (event: SessionEvent): string => {
      if (
        typeof event.payload === "object" &&
        event.payload !== null &&
        !Array.isArray(event.payload) &&
        typeof event.payload.lane === "string"
      ) {
        return event.payload.lane;
      }
      return "";
    };
    const routingEvents = events.filter(
      (event) => event.type === "model_routing",
    );
    return SessionMetricsSchema.parse({
      sessionId,
      eventCount: events.length,
      toolRuns: toolEvents.length,
      toolFailures: toolEvents.filter(
        (event) => payloadStatus(event) === "failed",
      ).length,
      deniedTools: toolEvents.filter(
        (event) => payloadStatus(event) === "denied",
      ).length,
      filesChanged: events.filter((event) => event.type === "file_modified")
        .length,
      modelSwitches: events.filter((event) => event.type === "session_runtime")
        .length,
      routingDecisions: routingEvents.length,
      fastRoutes: routingEvents.filter((event) => payloadLane(event) === "fast")
        .length,
      qualityRoutes: routingEvents.filter(
        (event) => payloadLane(event) === "quality",
      ).length,
      compactions: events.filter((event) => event.type === "history_compaction")
        .length,
      resumedCount: events.filter((event) => event.type === "session_resume")
        .length,
    });
  }

  /** Persist the crash-recovery state for the active agent run. */
  public saveRunJournal(sessionId: string, journal: RunJournal): RunJournal {
    const validated = RunJournalSchema.parse({ ...journal, sessionId });
    writeJsonAtomically(
      join(this.resolveSessionDirectory(sessionId), "run.json"),
      validated,
      RunJournalSchema,
    );
    return validated;
  }

  public getRunJournal(sessionId: string): RunJournal | undefined {
    let file: string;
    try {
      file = join(this.resolveSessionDirectory(sessionId), "run.json");
    } catch {
      return undefined;
    }
    for (const candidate of [file, `${file}.bak`]) {
      if (!existsSync(candidate)) continue;
      const parsed = readValidatedSnapshot(candidate, RunJournalSchema);
      if (parsed?.sessionId === sessionId) return parsed;
    }
    return undefined;
  }

  /** Build a bounded, secret-redacted trace without exposing the local workspace path. */
  public exportTrace(
    sessionId: string,
    options: { includeHistory?: boolean } = {},
  ): SessionTraceBundle {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Orbit session not found: ${sessionId}`);
    const plan = this.getTaskPlan(sessionId);
    const journal = this.getRunJournal(sessionId);
    const toolCalls = this.readToolCalls(sessionId).map((record) => ({
      ...record,
      inputJson: sanitizeTraceJsonText(record.inputJson, this.cwd),
      outputJson:
        record.outputJson === undefined
          ? undefined
          : sanitizeTraceJsonText(record.outputJson, this.cwd),
    }));
    const fileChanges = this.readFileChanges(sessionId).map((record) => ({
      ...record,
      path: normalizeTracePath(record.path, this.cwd),
      diff: replaceWorkspacePath(record.diff, this.cwd),
    }));
    const events = this.getEvents(sessionId).map((event) => ({
      ...event,
      payload: stripWorkspacePaths(event.payload, this.cwd),
    }));
    const history = options.includeHistory
      ? this.getHistory(sessionId).map((message) =>
          stripWorkspacePaths(
            sanitizeAuditValue(omitTraceImagePayloads(message)),
            this.cwd,
          ),
        )
      : undefined;

    return SessionTraceBundleSchema.parse({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace: {
        id: createHash("sha256").update(this.cwd).digest("hex").slice(0, 16),
        path: "<workspace>",
      },
      session: {
        ...session,
        cwd: "<workspace>",
        title: redactAuditText(session.title),
        goal: session.goal ? redactAuditText(session.goal) : undefined,
      },
      journal: journal
        ? {
            ...journal,
            phase: replaceWorkspacePath(journal.phase, this.cwd),
          }
        : undefined,
      plan: plan
        ? {
            ...plan,
            goal: plan.goal ? redactAuditText(plan.goal) : undefined,
            items: plan.items.map((item) => ({
              ...item,
              text: redactAuditText(item.text),
            })),
          }
        : undefined,
      metrics: this.getMetrics(sessionId),
      events,
      toolCalls,
      fileChanges,
      history,
    });
  }

  public saveTaskPlan(sessionId: string, plan: unknown): TaskPlan {
    const validated = TaskPlanSchema.parse({
      ...(typeof plan === "object" && plan !== null ? plan : {}),
      sessionId,
    });
    writeJsonAtomically(
      join(this.resolveSessionDirectory(sessionId), "plan.json"),
      validated,
      TaskPlanSchema,
    );
    return validated;
  }

  public getTaskPlan(sessionId: string): TaskPlan | undefined {
    let file: string;
    try {
      file = join(this.resolveSessionDirectory(sessionId), "plan.json");
    } catch {
      return undefined;
    }
    for (const candidate of [file, `${file}.bak`]) {
      if (!existsSync(candidate)) continue;
      const parsed = readValidatedSnapshot(candidate, TaskPlanSchema);
      if (parsed?.sessionId === sessionId) return parsed;
    }
    return undefined;
  }

  public recordToolCall(
    record: Omit<ToolCallRecord, "startedAt" | "endedAt"> &
      Partial<Pick<ToolCallRecord, "startedAt" | "endedAt">>,
  ): ToolCallRecord {
    const fullRecord = ToolCallRecordSchema.parse({
      ...record,
      inputJson: redactAuditJson(record.inputJson),
      outputJson:
        record.outputJson === undefined
          ? undefined
          : redactAuditJson(record.outputJson),
      startedAt: record.startedAt || new Date().toISOString(),
    });

    const file = join(
      this.resolveSessionDirectory(record.sessionId),
      "tool_calls.jsonl",
    );
    appendJsonLine(file, fullRecord);
    return fullRecord;
  }

  public getToolCalls(sessionId: string): ToolCallRecord[] {
    return this.readToolCalls(sessionId);
  }

  public recordFileChange(
    record: Omit<FileChangeRecord, "createdAt" | "id">,
  ): FileChangeRecord {
    const fullRecord = FileChangeRecordSchema.parse({
      ...record,
      diff: redactAuditText(record.diff),
      id: generateId("fc"),
      createdAt: new Date().toISOString(),
    });

    const file = join(
      this.resolveSessionDirectory(record.sessionId),
      "file_changes.jsonl",
    );
    appendJsonLine(file, fullRecord);
    return fullRecord;
  }

  private readToolCalls(sessionId: string): ToolCallRecord[] {
    return this.readValidatedJsonLines(
      sessionId,
      "tool_calls.jsonl",
      ToolCallRecordSchema,
    );
  }

  private readFileChanges(sessionId: string): FileChangeRecord[] {
    return this.readValidatedJsonLines(
      sessionId,
      "file_changes.jsonl",
      FileChangeRecordSchema,
    );
  }

  private readValidatedJsonLines<T>(
    sessionId: string,
    fileName: string,
    schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  ): T[] {
    let file: string;
    try {
      file = join(this.resolveSessionDirectory(sessionId), fileName);
    } catch {
      return [];
    }
    if (!existsSync(file)) return [];
    try {
      return (readBoundedRegularFile(file, SESSION_LOG_MAX_BYTES) ?? "")
        .split("\n")
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            const parsed = schema.safeParse(JSON.parse(line));
            return parsed.success && parsed.data ? [parsed.data] : [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  public saveHistory(sessionId: string, history: unknown): void {
    const validated = StoredHistorySchema.parse(history);
    const dir = this.resolveSessionDirectory(sessionId);
    const historyPath = join(dir, "history.json");
    writeJsonAtomically(historyPath, validated, StoredHistorySchema);
  }

  public getHistory(sessionId: string): StoredHistoryMessage[] {
    let file: string;
    try {
      file = join(this.resolveSessionDirectory(sessionId), "history.json");
    } catch {
      return [];
    }
    for (const candidate of [file, `${file}.bak`]) {
      if (!existsSync(candidate)) continue;
      const parsed = readValidatedSnapshot(candidate, StoredHistorySchema);
      if (parsed) return parsed;
    }
    return [];
  }

  public deleteSession(id: string): void {
    SessionIdSchema.parse(id);
    const dir = this.resolveSessionDirectory(id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private createUniqueSessionDirectory(): {
    id: string;
    directory: string;
  } {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = generateId("sess");
      const directory = this.resolveSessionDirectory(id);
      try {
        mkdirSync(directory, { mode: PRIVATE_DIRECTORY_MODE });
        return { id, directory };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
    }
    throw new Error("Unable to allocate a unique Orbit session id.");
  }

  private resolveSessionRoot(): string {
    const sessionRoot = resolveSafePath(this.cwd, this.sessionRootPath);
    if (sessionRoot === this.cwd) {
      throw new Error("Orbit session root cannot be the workspace root.");
    }
    if (existsSync(sessionRoot)) {
      const rootStats = lstatSync(sessionRoot);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error("Orbit session root must be a real directory.");
      }
    }
    return sessionRoot;
  }

  private resolveSessionDirectory(id: string): string {
    const validId = SessionIdSchema.parse(id);
    const sessionRoot = this.resolveSessionRoot();
    const resolved = resolveSafePath(this.cwd, join(sessionRoot, validId));
    const relativePath = relative(sessionRoot, resolved);
    if (
      relativePath !== validId ||
      relativePath.includes(sep) ||
      isAbsolute(relativePath)
    ) {
      throw new Error(`Invalid session directory: ${id}`);
    }
    if (existsSync(resolved)) {
      const stats = lstatSync(resolved);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`Invalid session directory: ${id}`);
      }
    }
    return resolved;
  }
}

function omitTraceImagePayloads(
  message: StoredHistoryMessage,
): StoredHistoryMessage {
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "image"
        ? {
            ...block,
            data: `[IMAGE OMITTED${block.name ? `: ${block.name}` : ""}]`,
          }
        : block,
    ),
  };
}
