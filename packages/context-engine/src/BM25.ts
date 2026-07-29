import { existsSync, promises as fsPromises } from "fs";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { readBoundedRegularFileAsync } from "@orbit-build/shared";
import { Document, DocumentSchema } from "./VectorStore.js";
import { getOrbitCachePath } from "./cachePaths.js";

const BM25_STORE_MAX_BYTES = 256 * 1024 * 1024;

export function tokenize(text: string): string[] {
  const rawWords = text
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Split camelCase
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, " ") // Keep alphanumeric, underscore, and chinese
    .split(/[\s_]+/)
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length > 1);

  const keywords = new Set([
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "break",
    "continue",
    "return",
    "function",
    "class",
    "const",
    "let",
    "var",
    "import",
    "export",
    "from",
    "default",
    "extends",
    "implements",
    "new",
    "this",
    "super",
    "public",
    "private",
    "protected",
    "async",
    "await",
    "try",
    "catch",
    "finally",
    "throw",
    "interface",
    "type",
    "package",
    "namespace",
    "module",
    "typeof",
    "instanceof",
    "void",
    "null",
    "undefined",
    "true",
    "false",
    "boolean",
    "number",
    "string",
    "any",
    "unknown",
    "never",
    "readonly",
    "as",
    "keyof",
  ]);

  return rawWords.filter((w) => !keywords.has(w));
}

const IndexDocSchema = z.object({
  id: z.string().min(1).max(4096),
  filePath: z.string().min(1).max(4096),
  terms: z.record(z.number().int().positive()),
  docLen: z.number().int().positive(),
});

type IndexDoc = z.infer<typeof IndexDocSchema>;

const BM25FileSchema = z.object({
  docs: z.record(IndexDocSchema),
});

function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export class BM25Store {
  private docs: Record<string, IndexDoc> = createRecord<IndexDoc>();
  private df: Record<string, number> = createRecord<number>();
  private avgdl: number = 0;
  private dbPath: string;
  private cachePathInitialized = false;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private cacheState: "uninitialized" | "missing" | "valid" | "invalid" =
    "uninitialized";

  constructor(private cwd: string) {
    this.dbPath = resolve(cwd, ".orbit", "bm25_store.json");
  }

  public async addDocuments(documents: Document[]): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    const validatedDocuments = z.array(DocumentSchema).parse(documents);
    for (const doc of validatedDocuments) {
      const tokens = tokenize(doc.text);
      if (tokens.length === 0) continue;

      // Clean old document references from DF if it already exists
      const oldDoc = this.docs[doc.id];
      if (oldDoc) {
        for (const term of Object.keys(oldDoc.terms)) {
          if (this.df[term]) {
            this.df[term]--;
            if (this.df[term] <= 0) delete this.df[term];
          }
        }
      }

      // Calculate term frequencies
      const terms = createRecord<number>();
      for (const t of tokens) {
        terms[t] = (terms[t] || 0) + 1;
      }

      // Update document frequencies for new/updated document
      for (const term of Object.keys(terms)) {
        this.df[term] = (this.df[term] || 0) + 1;
      }

      this.docs[doc.id] = {
        id: doc.id,
        filePath: doc.metadata.filePath,
        terms,
        docLen: tokens.length,
      };
    }

    this.recalculateStats();
    await this.save();
  }

  public async deleteByFilePath(filePath: string): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    let changed = false;
    for (const [id, doc] of Object.entries(this.docs)) {
      if (doc.filePath === filePath) {
        for (const term of Object.keys(doc.terms)) {
          if (this.df[term]) {
            this.df[term]--;
            if (this.df[term] <= 0) delete this.df[term];
          }
        }
        delete this.docs[id];
        changed = true;
      }
    }

    if (changed) {
      this.recalculateStats();
      await this.save();
    }
  }

  public async search(
    query: string,
    limit: number,
  ): Promise<Array<{ id: string; score: number }>> {
    if (!Number.isInteger(limit) || limit <= 0) {
      return [];
    }
    if (Object.keys(this.docs).length === 0) {
      await this.load();
    }

    const qTokens = tokenize(query);
    if (qTokens.length === 0 || Object.keys(this.docs).length === 0) {
      return [];
    }

    const N = Object.keys(this.docs).length;
    const k1 = 1.2;
    const b = 0.75;
    const results: Array<{ id: string; score: number }> = [];

    // Calculate BM25 score for each document
    for (const [id, doc] of Object.entries(this.docs)) {
      let score = 0.0;

      for (const term of qTokens) {
        const dfTerm = this.df[term] || 0;
        if (dfTerm === 0) continue;

        // IDF
        const idf = Math.log(1 + (N - dfTerm + 0.5) / (dfTerm + 0.5));

        // TF
        const tf = doc.terms[term] || 0;
        if (tf === 0) continue;

        // BM25 term score
        const tfScore =
          (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.docLen / this.avgdl)));
        score += idf * tfScore;
      }

      if (score > 0) {
        results.push({ id, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private recalculateStats(): void {
    const docList = Object.values(this.docs);
    if (docList.length === 0) {
      this.avgdl = 0;
      return;
    }
    const totalLen = docList.reduce((sum, d) => sum + d.docLen, 0);
    this.avgdl = totalLen / docList.length;
  }

  public async save(): Promise<void> {
    if (this.loading) await this.loading;
    this.initializeCachePath();
    try {
      const parentDir = dirname(this.dbPath);
      if (!existsSync(parentDir)) {
        await fsPromises.mkdir(parentDir, { recursive: true });
      }
      const data = {
        docs: this.docs,
        df: this.df,
        avgdl: this.avgdl,
      };
      const tmpPath = `${this.dbPath}.tmp-${process.pid}-${randomUUID()}`;
      try {
        await fsPromises.writeFile(
          tmpPath,
          JSON.stringify(data, null, 2),
          "utf8",
        );
        await fsPromises.rename(tmpPath, this.dbPath);
      } finally {
        await fsPromises.rm(tmpPath, { force: true }).catch(() => undefined);
      }
      this.cacheState = "valid";
    } catch {
      // Ignore
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
      this.docs = createRecord<IndexDoc>();
      this.df = createRecord<number>();
      this.avgdl = 0;
      this.cacheState = "missing";
      return;
    }
    try {
      const raw = await readBoundedRegularFileAsync(
        this.dbPath,
        BM25_STORE_MAX_BYTES,
      );
      if (raw === undefined) {
        this.cacheState = "missing";
        return;
      }
      const parsed = BM25FileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new Error("Invalid BM25 cache file.");
      }
      this.docs = createRecord<IndexDoc>();
      for (const [id, doc] of Object.entries(parsed.data.docs)) {
        if (id === doc.id) {
          this.docs[id] = {
            ...doc,
            terms: Object.assign(createRecord<number>(), doc.terms),
          };
        }
      }
      this.rebuildDocumentFrequencies();
      this.recalculateStats();
      this.cacheState = "valid";
    } catch {
      this.docs = createRecord<IndexDoc>();
      this.df = createRecord<number>();
      this.avgdl = 0;
      this.cacheState = "invalid";
    }
  }

  public async clear(): Promise<void> {
    if (this.loading) await this.loading;
    this.initializeCachePath();
    this.docs = createRecord<IndexDoc>();
    this.df = createRecord<number>();
    this.avgdl = 0;
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

  private rebuildDocumentFrequencies(): void {
    this.df = createRecord<number>();
    for (const doc of Object.values(this.docs)) {
      for (const term of Object.keys(doc.terms)) {
        this.df[term] = (this.df[term] || 0) + 1;
      }
    }
  }

  /** Reports whether an on-disk cache was present and passed validation. */
  public hasValidCache(): boolean {
    return this.cacheState === "valid";
  }

  private initializeCachePath(): void {
    if (this.cachePathInitialized) return;
    this.dbPath = getOrbitCachePath(this.cwd, "bm25_store.json");
    this.cachePathInitialized = true;
  }
}
