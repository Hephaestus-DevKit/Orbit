import { randomUUID } from "crypto";
import path from "path";
import {
  readBoundedRegularFile,
  redactSecrets,
  replacePrivateFileAtomically,
  resolveSafePath,
} from "@orbit-build/shared";
import { z } from "zod";

const PROJECT_MEMORY_MAX_BYTES = 1_048_576;

export const ProjectMemoryEntrySchema = z.object({
  id: z.string().regex(/^mem_[a-f0-9-]+$/),
  text: z.string().trim().min(1).max(2000),
  source: z.literal("user"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProjectMemorySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  enabled: z.boolean().default(true),
  entries: z.array(ProjectMemoryEntrySchema).max(100),
  updatedAt: z.string().datetime(),
});

export type ProjectMemory = z.infer<typeof ProjectMemorySchema>;
export type ProjectMemoryEntry = z.infer<typeof ProjectMemoryEntrySchema>;

/** Explicit, project-scoped memory. It never learns from conversation automatically. */
export class ProjectMemoryStore {
  private readonly candidateMemoryPath: string;
  private memoryPath: string | undefined;

  constructor(
    private readonly cwd: string,
    relativePath = ".orbit/memory.json",
  ) {
    this.candidateMemoryPath = path.resolve(cwd, relativePath);
  }

  /** Canonicalize the persistence path explicitly before filesystem access. */
  public initialize(): this {
    this.memoryPath = resolveSafePath(this.cwd, this.candidateMemoryPath);
    return this;
  }

  public read(): ProjectMemory {
    const memoryPath = this.getMemoryPath();
    for (const candidate of [memoryPath, `${memoryPath}.bak`]) {
      const parsed = this.readCandidate(candidate);
      if (parsed) return parsed;
    }
    return emptyMemory();
  }

  public add(text: string): ProjectMemoryEntry {
    const sanitized = sanitizeMemoryText(text);
    const now = new Date().toISOString();
    const entry = ProjectMemoryEntrySchema.parse({
      id: `mem_${randomUUID()}`,
      text: sanitized,
      source: "user",
      createdAt: now,
      updatedAt: now,
    });
    const memory = this.read();
    this.write({
      ...memory,
      entries: [...memory.entries, entry],
      updatedAt: now,
    });
    return entry;
  }

  public remove(id: string): boolean {
    const memory = this.read();
    const entries = memory.entries.filter((entry) => entry.id !== id);
    if (entries.length === memory.entries.length) return false;
    this.write({ ...memory, entries, updatedAt: new Date().toISOString() });
    return true;
  }

  public clear(): void {
    const current = this.read();
    this.write({
      ...current,
      entries: [],
      updatedAt: new Date().toISOString(),
    });
  }

  public setEnabled(enabled: boolean): ProjectMemory {
    const memory = {
      ...this.read(),
      enabled,
      updatedAt: new Date().toISOString(),
    };
    this.write(memory);
    return ProjectMemorySchema.parse(memory);
  }

  private write(value: ProjectMemory): void {
    const validated = ProjectMemorySchema.parse(value);
    const memoryPath = this.getMemoryPath();
    const previous = this.readCandidate(memoryPath);
    if (previous) {
      replacePrivateFileAtomically(
        `${memoryPath}.bak`,
        `${JSON.stringify(previous, null, 2)}\n`,
      );
    }
    replacePrivateFileAtomically(
      memoryPath,
      `${JSON.stringify(validated, null, 2)}\n`,
    );
  }

  private getMemoryPath(): string {
    if (!this.memoryPath) this.initialize();
    if (!this.memoryPath)
      throw new Error("Project memory path is unavailable.");
    return this.memoryPath;
  }

  private readCandidate(filePath: string): ProjectMemory | undefined {
    try {
      const raw = readBoundedRegularFile(filePath, PROJECT_MEMORY_MAX_BYTES);
      if (raw === undefined) return undefined;
      const parsed = ProjectMemorySchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}

function sanitizeMemoryText(value: string): string {
  return redactSecrets(value)
    .replace(
      /\b(api[-_ ]?key|authorization|access[-_ ]?token|secret)(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2***REDACTED***",
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer ***REDACTED***")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, "***REDACTED***")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyMemory(): ProjectMemory {
  return {
    schemaVersion: 1,
    enabled: true,
    entries: [],
    updatedAt: new Date(0).toISOString(),
  };
}
