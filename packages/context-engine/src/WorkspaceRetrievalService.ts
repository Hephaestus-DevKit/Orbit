import { resolve } from "path";
import type { SearchResult } from "./HybridSearch.js";
import { HybridSearch } from "./HybridSearch.js";
import { SymbolIndexer } from "./SymbolIndexer.js";

const DEFAULT_REFRESH_INTERVAL_MS = 2_000;
/** Prevent a long-lived WebUI/daemon process from retaining one index per project ever opened. */
export const MAX_CACHED_WORKSPACE_SERVICES = 8;

interface RetrievalIndex {
  index(): Promise<void>;
  getRepoMapText(maxTokens: number): Promise<string>;
}

export interface RetrievalSearch {
  load(): Promise<void>;
  search(
    query: string,
    embedFn: (texts: string[]) => Promise<number[][]>,
    options?: { limit?: number; candidateLimit?: number },
  ): Promise<SearchResult[]>;
}

export interface PreparedWorkspaceRetrieval {
  search: RetrievalSearch;
  repoMap: string;
  generation: number;
  refreshing: boolean;
}

export interface WorkspaceRetrievalServiceOptions {
  now?: () => number;
  refreshIntervalMs?: number;
  createIndex?: () => RetrievalIndex;
  createSearch?: () => RetrievalSearch;
}

/**
 * Owns one workspace's searchable snapshot and refresh lifecycle.
 *
 * The first request waits for a usable index. Later requests use the last
 * complete snapshot immediately while one coalesced refresh runs in the
 * background, so repository discovery never blocks every model turn.
 */
export class WorkspaceRetrievalService {
  private readonly index: RetrievalIndex;
  private readonly createSearch: () => RetrievalSearch;
  private readonly now: () => number;
  private readonly refreshIntervalMs: number;
  private search: RetrievalSearch | undefined;
  private refreshPromise: Promise<void> | undefined;
  private lastRefreshCompletedAt = Number.NEGATIVE_INFINITY;
  private generation = 0;
  private mutationRevision = 0;
  private indexedRevision = -1;

  public constructor(
    private readonly cwd: string,
    options: WorkspaceRetrievalServiceOptions = {},
  ) {
    this.index = options.createIndex?.() ?? new SymbolIndexer(cwd);
    this.createSearch = options.createSearch ?? (() => new HybridSearch(cwd));
    this.now = options.now ?? Date.now;
    this.refreshIntervalMs = Math.max(
      0,
      options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
    );
  }

  public async prepare(
    maxRepoMapTokens = 2_048,
  ): Promise<PreparedWorkspaceRetrieval> {
    if (!this.search) {
      await this.refresh();
    } else if (!this.refreshPromise && this.needsRefresh()) {
      void this.refresh().catch(() => undefined);
    }

    if (!this.search) {
      throw new Error("Workspace retrieval index did not become available.");
    }
    const search = this.search;
    const repoMap = await this.index.getRepoMapText(maxRepoMapTokens);
    return {
      search,
      repoMap,
      generation: this.generation,
      refreshing: this.refreshPromise !== undefined,
    };
  }

  /** Start or join a refresh without waiting for repo-map serialization. */
  public warm(): Promise<void> {
    if (!this.needsRefresh()) return Promise.resolve();
    return this.refresh();
  }

  /** Mark the current snapshot stale after a successful workspace mutation. */
  public invalidate(): void {
    this.mutationRevision += 1;
  }

  /** Wait until all invalidations observed during a refresh are indexed. */
  public async settle(): Promise<void> {
    while (this.refreshPromise || this.needsMutationRefresh()) {
      await (this.refreshPromise ?? this.refresh());
    }
  }

  private refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    const revision = this.mutationRevision;
    const refresh = (async () => {
      await this.index.index();
      const nextSearch = this.createSearch();
      await nextSearch.load();
      this.search = nextSearch;
      this.indexedRevision = revision;
      this.generation += 1;
      this.lastRefreshCompletedAt = this.now();
    })();
    const tracked = refresh.finally(() => {
      if (this.refreshPromise === tracked) this.refreshPromise = undefined;
    });
    this.refreshPromise = tracked;
    return tracked;
  }

  private needsRefresh(): boolean {
    return (
      this.needsMutationRefresh() ||
      this.now() - this.lastRefreshCompletedAt >= this.refreshIntervalMs
    );
  }

  private needsMutationRefresh(): boolean {
    return !this.search || this.indexedRevision !== this.mutationRevision;
  }
}

const workspaceServices = new Map<string, WorkspaceRetrievalService>();

/** Reuse the last complete search snapshot for every turn in one workspace. */
export function getWorkspaceRetrievalService(
  cwd: string,
): WorkspaceRetrievalService {
  const key = workspaceKey(cwd);
  let service = workspaceServices.get(key);
  if (service) {
    // Map insertion order is our small, allocation-free LRU list.
    workspaceServices.delete(key);
    workspaceServices.set(key, service);
  } else {
    service = new WorkspaceRetrievalService(cwd);
    workspaceServices.set(key, service);
  }
  evictIdleWorkspaceServices(key);
  return service;
}

/** Exposed for diagnostics and bounded-cache tests; it never exposes index data. */
export function getWorkspaceRetrievalServiceCacheSize(): number {
  return workspaceServices.size;
}

function evictIdleWorkspaceServices(currentKey: string): void {
  if (workspaceServices.size <= MAX_CACHED_WORKSPACE_SERVICES) return;
  for (const [key] of workspaceServices) {
    if (key === currentKey) continue;
    workspaceServices.delete(key);
    if (workspaceServices.size <= MAX_CACHED_WORKSPACE_SERVICES) return;
  }
}

function workspaceKey(cwd: string): string {
  const absolute = resolve(cwd).replace(/\\/g, "/");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}
