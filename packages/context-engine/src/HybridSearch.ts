import { JSVectorStore, Document } from "./VectorStore.js";
import { BM25Store } from "./BM25.js";

export interface SearchResult extends Document {
  hybridScore: number;
}

export class HybridSearch {
  private vectorStore: JSVectorStore;
  private bm25Store: BM25Store;
  private batchDepth = 0;
  private batchChanged = false;

  constructor(private cwd: string) {
    this.vectorStore = new JSVectorStore(cwd);
    this.bm25Store = new BM25Store(cwd);
  }

  /**
   * Load stores from disk.
   */
  public async load(): Promise<void> {
    await Promise.all([this.vectorStore.load(), this.bm25Store.load()]);
  }

  /** Returns true only when both persisted search caches passed validation. */
  public hasValidCaches(): boolean {
    return this.vectorStore.hasValidCache() && this.bm25Store.hasValidCache();
  }

  /**
   * Clear all indexed documents.
   */
  public async clear(): Promise<void> {
    await Promise.all([this.vectorStore.clear(), this.bm25Store.clear()]);
  }

  /**
   * Add documents to both vector and BM25 stores.
   */
  public async addDocuments(docs: Document[]): Promise<void> {
    const persist = this.batchDepth === 0;
    await this.vectorStore.addDocuments(docs, persist);
    await this.bm25Store.addDocuments(docs, persist);
    if (!persist) this.batchChanged = true;
  }

  /**
   * Incremental clean: delete old indices for a file path.
   */
  public async deleteByFilePath(filePath: string): Promise<void> {
    const persist = this.batchDepth === 0;
    await Promise.all([
      this.vectorStore.deleteByFilePath(filePath, persist),
      this.bm25Store.deleteByFilePath(filePath, persist),
    ]);
    if (!persist) this.batchChanged = true;
  }

  /** Defer persistence so one indexing generation performs one save per store. */
  public beginBatch(): void {
    this.batchDepth += 1;
  }

  public async commitBatch(): Promise<void> {
    if (this.batchDepth === 0) return;
    this.batchDepth -= 1;
    if (this.batchDepth > 0 || !this.batchChanged) return;
    this.batchChanged = false;
    await Promise.all([this.vectorStore.save(), this.bm25Store.save()]);
  }

  /**
   * Performs hybrid search using Reciprocal Rank Fusion (RRF).
   */
  public async search(
    query: string,
    embedFn: (texts: string[]) => Promise<number[][]>,
    options?: {
      limit?: number;
      candidateLimit?: number;
    },
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? 5;
    const candidateLimit = options?.candidateLimit ?? 40;
    if (
      !Number.isInteger(limit) ||
      limit <= 0 ||
      !Number.isInteger(candidateLimit) ||
      candidateLimit <= 0
    ) {
      return [];
    }

    // Load stores just in case
    await this.load();

    // 1. Get lexical (BM25) search candidates
    const bm25Candidates = await this.bm25Store.search(query, candidateLimit);

    // 2. Get semantic (Vector) search candidates
    let vectorCandidates: Array<Document & { score: number }> = [];
    try {
      const vectors = await embedFn([query]);
      if (vectors && vectors.length > 0) {
        vectorCandidates = await this.vectorStore.search(
          vectors[0],
          candidateLimit,
        );
      }
    } catch {
      // Fallback: If embedding fails, we will rely only on BM25
    }

    // 3. Perform Reciprocal Rank Fusion (RRF)
    // Document ID -> Document (we fetch document details from vector store or cached docs)
    const docMap = new Map<string, Document>();

    // We can populate document metadata from either source.
    // The vectorStore search returns Document objects, let's load all docs into docMap first
    // We need to retrieve full documents to construct return values.
    // Since VectorStore stores documents with vectors, we load the database documents.
    // To avoid reading file multiple times, we can access vectorStore's in-memory documents list.
    const allDocs = this.vectorStore.getDocuments();
    const allDocsMap = new Map(allDocs.map((d) => [d.id, d]));

    // Rank maps
    const vectorRanks = new Map<string, number>();
    const bm25Ranks = new Map<string, number>();

    vectorCandidates.forEach((cand, index) => {
      vectorRanks.set(cand.id, index + 1); // 1-based index
      docMap.set(cand.id, cand);
    });

    bm25Candidates.forEach((cand, index) => {
      bm25Ranks.set(cand.id, index + 1); // 1-based index
      const doc = allDocsMap.get(cand.id);
      if (doc) {
        docMap.set(cand.id, doc);
      }
    });

    const rrfK = 60; // Standard RRF parameter
    const hybridScores = new Map<string, number>();

    // Calculate RRF Score for all touched documents
    for (const docId of docMap.keys()) {
      const vRank = vectorRanks.get(docId);
      const bRank = bm25Ranks.get(docId);

      const vScore = vRank ? 1 / (rrfK + vRank) : 0;
      const bScore = bRank ? 1 / (rrfK + bRank) : 0;

      hybridScores.set(docId, vScore + bScore);
    }

    // Sort by hybrid score descending
    const sortedIds = Array.from(hybridScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    // Build final results
    return sortedIds.map(([docId, rrfScore]) => {
      const doc = docMap.get(docId)!;
      // We strip the vector from the returned results to reduce size
      const cleanDoc = { ...doc };
      delete cleanDoc.vector;
      return {
        ...cleanDoc,
        hybridScore: rrfScore,
      };
    });
  }
}
