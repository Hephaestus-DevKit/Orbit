import { existsSync, promises as fsPromises } from "fs";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { readBoundedRegularFileAsync } from "@orbit-build/shared";
import { getOrbitCachePath } from "./cachePaths.js";

const VECTOR_STORE_MAX_BYTES = 256 * 1024 * 1024;
const VECTOR_STORE_MAX_DOCUMENTS = 100_000;
const EmbeddingVectorSchema = z.array(z.number().finite()).min(1).max(32768);

export const DocumentSchema = z.object({
  id: z.string().min(1).max(4096),
  text: z.string().max(2_000_000),
  vector: EmbeddingVectorSchema.optional(),
  metadata: z.object({
    filePath: z.string().min(1).max(4096),
    symbolName: z.string().max(4096).optional(),
    symbolType: z.string().max(256).optional(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  }),
});

export type Document = z.infer<typeof DocumentSchema>;

export interface VectorStore {
  addDocuments(docs: Document[]): Promise<void>;
  search(
    queryVector: number[],
    limit: number,
  ): Promise<Array<Document & { score: number }>>;
  deleteByFilePath(filePath: string): Promise<void>;
  save(): Promise<void>;
  load(): Promise<void>;
  clear(): Promise<void>;
}

export const DBHeaderSchema = z.object({
  modelName: z.string().min(1).max(1024),
  dimension: z.number().int().positive().max(32768),
  updatedAt: z.string().min(1),
});

export type DBHeader = z.infer<typeof DBHeaderSchema>;

const VectorStoreFileSchema = z.object({
  header: DBHeaderSchema.nullable(),
  documents: z.array(DocumentSchema).max(VECTOR_STORE_MAX_DOCUMENTS),
});

const LegacyVectorStoreFileSchema = z
  .array(DocumentSchema)
  .max(VECTOR_STORE_MAX_DOCUMENTS);

export class JSVectorStore implements VectorStore {
  private documents: Document[] = [];
  private dbPath: string;
  private cachePathInitialized = false;
  private header: DBHeader | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private cacheState: "uninitialized" | "missing" | "valid" | "invalid" =
    "uninitialized";
  private persistenceError: string | undefined;

  constructor(
    private cwd: string,
    private modelName?: string,
  ) {
    this.dbPath = resolve(cwd, ".orbit", "vector_store.json");
  }

  public async addDocuments(docs: Document[], persist = true): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    const validatedDocs = z
      .array(DocumentSchema)
      .max(VECTOR_STORE_MAX_DOCUMENTS)
      .parse(docs);
    const vectorDimensions = new Set(
      validatedDocs.flatMap((doc) =>
        doc.vector === undefined ? [] : [doc.vector.length],
      ),
    );
    if (vectorDimensions.size > 1) {
      throw new Error("Embedding documents must use one vector dimension.");
    }

    const inputDim = vectorDimensions.values().next().value as
      | number
      | undefined;
    if (inputDim !== undefined) {
      const existingDoc = this.documents.find(
        (d) => d.vector && d.vector.length > 0,
      );
      if (
        (existingDoc &&
          existingDoc.vector &&
          existingDoc.vector.length !== inputDim) ||
        (this.header && this.header.dimension !== inputDim)
      ) {
        this.documents = [];
      }
      this.header = {
        modelName: this.modelName || "default",
        dimension: inputDim,
        updatedAt: new Date().toISOString(),
      };
    }

    // Overwrite docs with same IDs or add new ones
    const docMap = new Map(this.documents.map((d) => [d.id, d]));
    for (const doc of validatedDocs) {
      docMap.set(doc.id, doc);
    }
    if (docMap.size > VECTOR_STORE_MAX_DOCUMENTS) {
      throw new Error(
        `Vector store cannot contain more than ${VECTOR_STORE_MAX_DOCUMENTS} documents.`,
      );
    }
    this.documents = Array.from(docMap.values());
    if (persist) await this.save();
  }

  public async deleteByFilePath(
    filePath: string,
    persist = true,
  ): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    const originalLength = this.documents.length;
    this.documents = this.documents.filter(
      (doc) => doc.metadata.filePath !== filePath,
    );
    if (persist && this.documents.length !== originalLength) {
      await this.save();
    }
  }

  public async search(
    queryVector: number[],
    limit: number,
  ): Promise<Array<Document & { score: number }>> {
    const validatedVector = EmbeddingVectorSchema.safeParse(queryVector);
    if (!validatedVector.success || !Number.isInteger(limit) || limit <= 0) {
      return [];
    }
    queryVector = validatedVector.data;
    if (this.documents.length === 0) {
      await this.load();
    }

    if (this.documents.length > 0) {
      const existingDoc = this.documents.find(
        (d) => d.vector && d.vector.length > 0,
      );
      if (
        (existingDoc &&
          existingDoc.vector &&
          existingDoc.vector.length !== queryVector.length) ||
        (this.header && this.header.dimension !== queryVector.length)
      ) {
        await this.clear();
        return [];
      }
    }

    const results: Array<Document & { score: number }> = [];
    for (const doc of this.documents) {
      if (!doc.vector || doc.vector.length !== queryVector.length) {
        continue;
      }
      const score = this.cosineSimilarity(queryVector, doc.vector);
      results.push({
        ...doc,
        score,
      });
    }

    // Sort descending by score
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  public async save(): Promise<void> {
    if (this.loading) await this.loading;
    this.initializeCachePath();
    try {
      const parentDir = dirname(this.dbPath);
      if (!existsSync(parentDir)) {
        await fsPromises.mkdir(parentDir, { recursive: true });
      }
      const dataToSave = {
        header: this.header,
        documents: this.documents,
      };
      const tmpPath = `${this.dbPath}.tmp-${process.pid}-${randomUUID()}`;
      try {
        await fsPromises.writeFile(
          tmpPath,
          JSON.stringify(dataToSave, null, 2),
          "utf8",
        );
        await fsPromises.rename(tmpPath, this.dbPath);
      } finally {
        await fsPromises.rm(tmpPath, { force: true }).catch(() => undefined);
      }
      this.cacheState = "valid";
      this.persistenceError = undefined;
    } catch (error: unknown) {
      this.cacheState = "invalid";
      this.persistenceError =
        error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to persist the Orbit vector cache: ${this.persistenceError}`,
      );
    }
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = this.loadFromDisk().finally(() => {
        this.loaded = true;
        this.loading = null;
      });
    }
    await this.loading;
  }

  private async loadFromDisk(): Promise<void> {
    this.initializeCachePath();
    if (!existsSync(this.dbPath)) {
      this.documents = [];
      this.header = null;
      this.cacheState = "missing";
      return;
    }
    try {
      const raw = await readBoundedRegularFileAsync(
        this.dbPath,
        VECTOR_STORE_MAX_BYTES,
      );
      if (raw === undefined) {
        this.cacheState = "missing";
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      const currentFormat = VectorStoreFileSchema.safeParse(parsed);
      if (currentFormat.success) {
        this.documents = currentFormat.data.documents;
        this.header = currentFormat.data.header;
        this.cacheState = "valid";
      } else {
        const legacyFormat = LegacyVectorStoreFileSchema.safeParse(parsed);
        this.documents = legacyFormat.success ? legacyFormat.data : [];
        this.header = null;
        this.cacheState = legacyFormat.success ? "valid" : "invalid";
      }

      // Check model name mismatch
      if (
        this.modelName &&
        this.header &&
        this.header.modelName &&
        this.header.modelName !== this.modelName
      ) {
        this.documents = [];
        this.header = null;
        this.cacheState = "missing";
        await fsPromises.unlink(this.dbPath).catch(() => undefined);
      }
    } catch {
      this.documents = [];
      this.header = null;
      this.cacheState = "invalid";
    }
  }

  public async clear(): Promise<void> {
    if (this.loading) await this.loading;
    this.initializeCachePath();
    this.documents = [];
    this.header = null;
    this.loaded = true;
    this.cacheState = "missing";
    if (existsSync(this.dbPath)) {
      try {
        await fsPromises.unlink(this.dbPath);
      } catch {
        // Ignore
      }
    }
  }

  /** Returns the validated in-memory documents without exposing mutable storage. */
  public getDocuments(): readonly Document[] {
    return this.documents;
  }

  /** Reports whether an on-disk cache was present and passed validation. */
  public hasValidCache(): boolean {
    return this.cacheState === "valid";
  }

  /** Returns the last persistence failure without exposing filesystem details. */
  public getPersistenceError(): string | undefined {
    return this.persistenceError;
  }

  private initializeCachePath(): void {
    if (this.cachePathInitialized) return;
    this.dbPath = getOrbitCachePath(this.cwd, "vector_store.json");
    this.cachePathInitialized = true;
  }

  /**
   * Helper to calculate Cosine Similarity between two vectors.
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0.0 || normB === 0.0) {
      return 0.0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
