import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "fs";
import { promises as fsPromises } from "fs";
import { join, dirname, isAbsolute, resolve } from "path";
import { createHash } from "crypto";
import glob from "fast-glob";
import { z } from "zod";
import { ConfigLoader } from "@orbit-build/config";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  resolveSafePath,
} from "@orbit-build/shared";
import ts from "typescript";
import { ASTChunker } from "./ASTChunker.js";
import { HybridSearch } from "./HybridSearch.js";
import { getOrbitCachePath } from "./cachePaths.js";
import {
  OpenAIProvider,
  isOfficialDeepSeekApi,
  OllamaProvider,
  type ModelProvider,
  type ProviderRuntimeOptions,
} from "@orbit-build/model-providers";

interface EmbeddingProviderConfig {
  type?: string;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
  maxRetries?: number;
}

interface EmbeddingConfig {
  provider?: { default?: string; embedding?: string };
  providers?: Record<string, EmbeddingProviderConfig | undefined>;
}

const inFlightIndexes = new Map<string, Promise<void>>();

function workspaceIndexKey(cwd: string): string {
  const absolute = resolve(cwd).replace(/\\/g, "/");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function resolveConfiguredApiKey(
  provider: EmbeddingProviderConfig,
): string | undefined {
  try {
    return (
      provider.apiKey ||
      (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined)
    );
  } catch {
    return provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
  }
}

function providerRuntimeOptions(
  id: string,
  provider: EmbeddingProviderConfig,
): ProviderRuntimeOptions {
  return {
    id,
    apiKeyEnv: provider.apiKeyEnv,
    apiKeyHeader: provider.apiKeyHeader,
    apiKeyPrefix: provider.apiKeyPrefix,
    headers: provider.headers,
    requestTimeoutMs: provider.requestTimeoutMs,
    maxRetries: provider.maxRetries,
    disablePreheat: true,
  };
}

function findConfiguredOpenAIEmbeddingProvider(
  config: EmbeddingConfig,
): ModelProvider | null {
  const candidates = Object.entries(config.providers || {}).sort(
    ([leftId], [rightId]) =>
      embeddingProviderRank(rightId) - embeddingProviderRank(leftId),
  );
  for (const [id, provider] of candidates) {
    if (
      !provider ||
      (provider.type !== "openai" && provider.type !== "openai-compatible")
    ) {
      continue;
    }
    const resolved = createEmbeddingProvider(id, provider);
    if (resolved) return resolved;
  }
  return null;
}

function embeddingProviderRank(id: string): number {
  if (/embed/i.test(id)) return 3;
  if (id === "openai") return 2;
  return 1;
}

function createEmbeddingProvider(
  id: string,
  provider: EmbeddingProviderConfig,
): ModelProvider | null {
  const baseUrl = provider.baseUrl;
  if (provider.type === "ollama") {
    return new OllamaProvider(baseUrl);
  }
  if (provider.type !== "openai" && provider.type !== "openai-compatible") {
    return null;
  }
  if (
    (provider.type === "openai-compatible" && !baseUrl) ||
    (baseUrl && isOfficialDeepSeekApi(baseUrl))
  ) {
    return null;
  }
  const apiKey = resolveConfiguredApiKey(provider);
  if (!apiKey) return null;
  return new OpenAIProvider(
    apiKey,
    baseUrl,
    providerRuntimeOptions(id, provider),
  );
}

export const SymbolEntrySchema = z.object({
  name: z.string().min(1).max(4096),
  type: z.enum(["class", "interface", "function", "constant", "type"]),
  line: z.number().int().positive(),
});

export const FileIndexSchema = z.object({
  mtime: z.number().finite().nonnegative(),
  size: z.number().int().nonnegative().optional(),
  symbols: z.array(SymbolEntrySchema),
  imports: z.array(z.string().max(4096)).optional(),
});

export const SymbolIndexSchema = z.object({
  files: z.record(FileIndexSchema),
  indexedAt: z.string(),
});

export type SymbolEntry = z.infer<typeof SymbolEntrySchema>;
export type FileIndex = z.infer<typeof FileIndexSchema>;
export type SymbolIndex = z.infer<typeof SymbolIndexSchema>;

const EmbeddingCacheFileSchema = z.object({
  model: z.string().min(1).max(1024),
  cache: z.record(
    z.string().regex(/^[0-9a-f]{64}$/),
    z.array(z.number().finite()).min(1).max(32768),
  ),
});

const PackageJsonSchema = z.object({
  name: z.string().min(1).max(4096).optional(),
});

class EmbeddingCache {
  private cache: Record<string, number[]> = {};
  private cachePath: string | undefined;

  constructor(
    private cwd: string,
    private modelName: string,
  ) {}

  public initialize(): void {
    this.cachePath = getOrbitCachePath(this.cwd, "embedding_cache.json");
    this.load();
  }

  private load(): void {
    if (this.cachePath && existsSync(this.cachePath)) {
      try {
        const raw = readFileSync(this.cachePath, "utf8");
        const parsed = EmbeddingCacheFileSchema.safeParse(JSON.parse(raw));
        if (parsed.success && parsed.data.model === this.modelName) {
          this.cache = parsed.data.cache;
        } else {
          this.cache = {};
        }
      } catch {
        this.cache = {};
      }
    }
  }

  public save(): void {
    if (!this.cachePath) return;
    try {
      const parentDir = dirname(this.cachePath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      const data = {
        model: this.modelName,
        cache: this.cache,
      };
      const tmpPath = this.cachePath + ".tmp";
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
      renameSync(tmpPath, this.cachePath);
    } catch {
      // Ignore
    }
  }

  public get(text: string): number[] | undefined {
    const hash = createHash("sha256").update(text).digest("hex");
    return this.cache[hash];
  }

  public set(text: string, vector: number[]): void {
    if (
      vector.length === 0 ||
      vector.length > 32768 ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      return;
    }
    const hash = createHash("sha256").update(text).digest("hex");
    this.cache[hash] = vector;
  }
}

/**
 * Resolves an embedding-capable provider without probing unsupported APIs.
 *
 * The official DeepSeek API exposes chat/FIM endpoints but no embeddings
 * endpoint. When DeepSeek is the active chat provider, use a separately
 * configured OpenAI provider with a resolved key or fall back to lexical BM25.
 */
export function getEmbeddingProvider(
  config: EmbeddingConfig,
): ModelProvider | null {
  const embeddingProviderId = config.provider?.embedding;
  if (embeddingProviderId) {
    const embeddingProvider = config.providers?.[embeddingProviderId];
    return embeddingProvider
      ? createEmbeddingProvider(embeddingProviderId, embeddingProvider)
      : null;
  }

  const providerId = config.provider?.default || "deepseek-openai";
  const providerConfig = config.providers?.[providerId];

  if (!providerConfig) {
    return findConfiguredOpenAIEmbeddingProvider(config);
  }

  return (
    createEmbeddingProvider(providerId, providerConfig) ??
    findConfiguredOpenAIEmbeddingProvider(config)
  );
}

export class SymbolIndexer {
  public indexPath: string;

  constructor(private cwd: string) {
    this.indexPath = resolve(cwd, ".orbit", "symbols.json");
  }

  /**
   * Run the indexer asynchronously and incrementally.
   */
  public index(): Promise<void> {
    const key = workspaceIndexKey(this.cwd);
    const existing = inFlightIndexes.get(key);
    if (existing) return existing;

    const tracked = this.performIndex().finally(() => {
      if (inFlightIndexes.get(key) === tracked) {
        inFlightIndexes.delete(key);
      }
    });
    inFlightIndexes.set(key, tracked);
    return tracked;
  }

  private async performIndex(): Promise<void> {
    try {
      this.initializeIndexPath();
      // Skip indexing if cwd is user's home directory or system root directory
      const normCwd = resolve(this.cwd).toLowerCase().replace(/\\/g, "/");
      const { homedir } = await import("os");
      const normHome = resolve(homedir()).toLowerCase().replace(/\\/g, "/");
      if (
        normCwd === normHome ||
        normCwd === "/" ||
        /^[a-zA-Z]:\/$/.test(normCwd) ||
        dirname(normCwd) === normCwd
      ) {
        return;
      }

      const config = ConfigLoader.loadSync(this.cwd);
      const userIgnores = config.context?.ignore || [];
      const defaultSystemIgnores = [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.git/**",
        "**/coverage/**",
        "**/.next/**",
        "**/.turbo/**",
        "**/AppData/**",
        "**/Local Settings/**",
        "**/Downloads/**",
        "**/Documents/**",
        "**/Pictures/**",
        "**/Music/**",
        "**/Videos/**",
        "**/.npm/**",
        "**/.cargo/**",
        "**/.gradle/**",
        "**/.rustup/**",
        "**/.orbit/**",
      ];
      const ignorePatterns = Array.from(
        new Set([...userIgnores, ...defaultSystemIgnores]),
      );

      // Load existing index if present
      let indexData: SymbolIndex = {
        files: {},
        indexedAt: new Date().toISOString(),
      };
      if (existsSync(this.indexPath)) {
        try {
          const raw = await fsPromises.readFile(this.indexPath, "utf8");
          indexData = this.parseSymbolIndex(raw) ?? indexData;
        } catch {
          // Ignore parse errors and start fresh
        }
      }

      const hybridSearch = new HybridSearch(this.cwd);
      await hybridSearch.load();
      if (
        Object.keys(indexData.files).length > 0 &&
        !hybridSearch.hasValidCaches()
      ) {
        await hybridSearch.clear();
        indexData = {
          files: {},
          indexedAt: new Date().toISOString(),
        };
      }

      const embeddingModel =
        config.models?.embedding || "text-embedding-3-small";
      const embedCache = new EmbeddingCache(this.cwd, embeddingModel);
      embedCache.initialize();
      let provider: ModelProvider | null = null;
      try {
        provider = getEmbeddingProvider(config);
      } catch {
        // Fallback: provider is null, RAG will run BM25 only
      }

      // Find JS/TS files using glob matching context.ignore
      const files = await glob("**/*.{ts,tsx,js,jsx}", {
        cwd: this.cwd,
        ignore: ignorePatterns,
        onlyFiles: true,
        absolute: false,
        followSymbolicLinks: false,
        suppressErrors: true,
      });

      let gitFiles: Set<string> | null = null;
      try {
        const { execSync } = await import("child_process");
        const stdout = execSync(
          "git ls-files --cached --others --exclude-standard",
          {
            ...HIDDEN_CHILD_PROCESS_OPTIONS,
            cwd: this.cwd,
            stdio: ["ignore", "pipe", "ignore"],
          },
        ).toString();
        gitFiles = new Set(
          stdout
            .split(/\r?\n/)
            .map((f) => f.trim())
            .filter(Boolean),
        );
      } catch {
        // Not a git repo or git not installed/available
      }

      const filteredFiles = (
        gitFiles ? files.filter((f) => gitFiles!.has(f)) : files
      ).sort((left, right) => left.localeCompare(right));

      const maxFiles = config.context?.maxFilesToIndex ?? 5000;
      const slicedFiles =
        filteredFiles.length > maxFiles
          ? filteredFiles.slice(0, maxFiles)
          : filteredFiles;

      const activeFiles = new Set<string>();
      const maxFileBytes = config.context.maxFileSizeKb * 1024;
      let changed = false;
      let i = 0;

      for (const relativePath of slicedFiles) {
        i++;
        if (i % 50 === 0) {
          await new Promise<void>((res) => setImmediate(res));
        }
        try {
          // Resolve each path independently so one unsafe symlink cannot abort indexing.
          const absolutePath = resolveSafePath(this.cwd, relativePath);
          const stats = await fsPromises.stat(absolutePath);
          if (!stats.isFile() || stats.size > maxFileBytes) {
            continue;
          }
          activeFiles.add(relativePath);
          const mtime = stats.mtimeMs;
          const cached = indexData.files[relativePath];

          if (cached && cached.mtime === mtime && cached.size === stats.size) {
            continue;
          }

          // Read and parse file symbols & imports
          const content = await fsPromises.readFile(absolutePath, "utf8");
          const { symbols, imports } = this.parseFile(content, relativePath);

          // Chunk file
          const chunks = ASTChunker.chunkFile(content, relativePath, symbols);

          // Embed chunks
          const uncachedTexts: string[] = [];
          for (const chunk of chunks) {
            const cachedVector = embedCache.get(chunk.text);
            if (cachedVector) {
              chunk.vector = cachedVector;
            } else {
              uncachedTexts.push(chunk.text);
            }
          }

          if (uncachedTexts.length > 0 && provider?.embed) {
            try {
              const embeddingModel =
                config.models?.embedding || "text-embedding-3-small";
              const embed = provider.embed.bind(provider);
              const vectors = await embed(uncachedTexts, {
                model: embeddingModel,
              });
              let vectorIdx = 0;
              for (const chunk of chunks) {
                if (!chunk.vector) {
                  const vec = vectors[vectorIdx++];
                  if (vec) {
                    chunk.vector = vec;
                    embedCache.set(chunk.text, vec);
                  }
                }
              }
            } catch {
              // Fail silently on embed errors, chunks will only have lexical BM25 coverage
            }
          }

          // Delete old indexing for this file, then save new chunks
          await hybridSearch.deleteByFilePath(relativePath);
          if (chunks.length > 0) {
            await hybridSearch.addDocuments(chunks);
          }

          indexData.files[relativePath] = {
            mtime,
            size: stats.size,
            symbols,
            imports,
          };
          changed = true;
        } catch {
          // Skip file if unreadable
        }
      }

      // Remove files no longer in active workspace list
      for (const relativePath of Object.keys(indexData.files)) {
        if (!activeFiles.has(relativePath)) {
          delete indexData.files[relativePath];
          await hybridSearch.deleteByFilePath(relativePath);
          changed = true;
        }
      }

      if (changed) {
        indexData.indexedAt = new Date().toISOString();
        const parentDir = dirname(this.indexPath);
        if (!existsSync(parentDir)) {
          await fsPromises.mkdir(parentDir, { recursive: true });
        }
        const tmpPath = this.indexPath + ".tmp";
        await fsPromises.writeFile(
          tmpPath,
          JSON.stringify(indexData, null, 2),
          "utf8",
        );
        await fsPromises.rename(tmpPath, this.indexPath);
        embedCache.save();
      }
    } catch {
      // Fail silently to avoid blocking process lifecycle
    }
  }

  /**
   * Helper to query matched symbols by name query.
   */
  public async search(
    query: string,
  ): Promise<Array<SymbolEntry & { filePath: string }>> {
    const results: Array<SymbolEntry & { filePath: string }> = [];
    this.initializeIndexPath();
    if (!existsSync(this.indexPath)) {
      return results;
    }

    try {
      const raw = await fsPromises.readFile(this.indexPath, "utf8");
      const indexData = this.parseSymbolIndex(raw);
      if (!indexData) return results;

      const lowercaseQuery = query.toLowerCase();
      for (const [filePath, fileData] of Object.entries(indexData.files)) {
        for (const sym of fileData.symbols) {
          if (sym.name.toLowerCase().includes(lowercaseQuery)) {
            results.push({
              ...sym,
              filePath,
            });
          }
        }
      }
    } catch {
      // Fail silently
    }

    return results;
  }

  /**
   * Generates a dense, token-efficient map of the codebase landmarks (Repo Map)
   * using PageRank weights computed from AST imports and exports.
   */
  public async getRepoMapText(tokenLimit: number = 2048): Promise<string> {
    this.initializeIndexPath();
    if (!existsSync(this.indexPath)) {
      return "";
    }

    try {
      const raw = await fsPromises.readFile(this.indexPath, "utf8");
      const indexData = this.parseSymbolIndex(raw);
      if (!indexData) return "";
      const allFiles = new Set(Object.keys(indexData.files));

      // 1. Build package map from workspace package.json files
      const packageMap: Record<string, string> = {};
      try {
        const packageJsonFiles = await glob("**/package.json", {
          cwd: this.cwd,
          ignore: ["**/node_modules/**", "**/dist/**"],
          onlyFiles: true,
          absolute: false,
          followSymbolicLinks: false,
          suppressErrors: true,
        });
        for (const relPath of packageJsonFiles) {
          try {
            const absPath = resolveSafePath(this.cwd, relPath);
            const content = await fsPromises.readFile(absPath, "utf8");
            const pkg = PackageJsonSchema.safeParse(JSON.parse(content));
            if (pkg.success && pkg.data.name) {
              packageMap[pkg.data.name] = dirname(relPath).replace(/\\/g, "/");
            }
          } catch {
            // Ignore
          }
        }
      } catch {
        // Ignore
      }

      // 2. Resolve imports for each file to construct the dependency graph edges
      const resolvedEdges = new Map<string, Set<string>>();
      for (const [filePath, fileData] of Object.entries(indexData.files)) {
        const edges = new Set<string>();
        const imports = fileData.imports || [];
        for (const imp of imports) {
          const resolved = this.resolveImportPath(
            filePath,
            imp,
            allFiles,
            packageMap,
          );
          if (resolved && resolved !== filePath) {
            edges.add(resolved);
          }
        }
        resolvedEdges.set(filePath, edges);
      }

      // 3. Compute PageRank scores
      const pageRanks = this.computePageRank(indexData.files, resolvedEdges);

      // Sort files by PageRank score descending
      const sortedFiles = Object.keys(indexData.files).sort((a, b) => {
        const scoreA = pageRanks[a] || 0;
        const scoreB = pageRanks[b] || 0;
        return scoreB - scoreA;
      });

      // 4. Greedily select files to display in detail based on token budget
      const detailedFiles = new Set<string>();
      const outlineFiles = new Set<string>();
      const estTokens = (s: string) => Math.ceil(s.length / 4);

      // Build the base mapping: initially, all files are in "simple" (just paths) mode.
      // We will iteratively upgrade the highest ranked files.
      let currentOutput = "";
      const buildOutput = () => {
        let out = "## Codebase Landmark Map\n\n";

        // Show detailed landmarks first
        const detailedList = sortedFiles.filter((f) => detailedFiles.has(f));
        if (detailedList.length > 0) {
          out += "### Detailed Landmarks\n";
          for (const file of detailedList) {
            const fileData = indexData.files[file];
            out += `${file}:\n`;
            if (fileData.symbols && fileData.symbols.length > 0) {
              for (const sym of fileData.symbols) {
                out += `  - ${sym.type} ${sym.name} (line ${sym.line})\n`;
              }
            } else {
              out += `  (no symbols)\n`;
            }
          }
          out += "\n";
        }

        // Show outlined landmarks next
        const outlineList = sortedFiles.filter((f) => outlineFiles.has(f));
        if (outlineList.length > 0) {
          out += "### Outlined Landmarks (Classes & Interfaces)\n";
          for (const file of outlineList) {
            const fileData = indexData.files[file];
            out += `${file}:\n`;
            const classAndInterfaceSymbols =
              fileData.symbols?.filter(
                (symbol) =>
                  symbol.type === "class" || symbol.type === "interface",
              ) || [];
            if (classAndInterfaceSymbols.length > 0) {
              for (const sym of classAndInterfaceSymbols) {
                out += `  - ${sym.type} ${sym.name} (line ${sym.line})\n`;
              }
            } else {
              out += `  (outline: no classes or interfaces)\n`;
            }
          }
          out += "\n";
        }

        // Show remaining files as simple paths
        const simpleFiles = sortedFiles.filter(
          (f) => !detailedFiles.has(f) && !outlineFiles.has(f),
        );
        if (simpleFiles.length > 0) {
          out += "### Other Files\n";
          for (const file of simpleFiles) {
            out += `${file}\n`;
          }
        }
        return out;
      };

      // Greedily upgrade top files
      for (const file of sortedFiles) {
        // Try detailed first
        detailedFiles.add(file);
        let nextOutput = buildOutput();
        if (estTokens(nextOutput) <= tokenLimit) {
          currentOutput = nextOutput;
          continue;
        }

        // Exceeds, degrade to outline
        detailedFiles.delete(file);
        outlineFiles.add(file);
        nextOutput = buildOutput();
        if (estTokens(nextOutput) <= tokenLimit) {
          currentOutput = nextOutput;
          continue;
        }

        // Exceeds, fallback to simple
        outlineFiles.delete(file);
      }

      // If even no files upgraded fits (very small tokenLimit), fall back to simple output
      if (!currentOutput) {
        currentOutput = buildOutput();
      }

      return currentOutput;
    } catch {
      return "";
    }
  }

  private resolveImportPath(
    fromFile: string,
    importPath: string,
    allFiles: Set<string>,
    packageMap: Record<string, string>,
  ): string | null {
    if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
      let matchedPackageKey = "";
      for (const pkgName of Object.keys(packageMap)) {
        if (importPath === pkgName || importPath.startsWith(pkgName + "/")) {
          if (pkgName.length > matchedPackageKey.length) {
            matchedPackageKey = pkgName;
          }
        }
      }

      if (matchedPackageKey) {
        const pkgDir = packageMap[matchedPackageKey];
        const remainder = importPath.substring(matchedPackageKey.length);
        const targetPath = join(pkgDir, remainder).replace(/\\/g, "/");

        const candidates = this.getImportCandidates(targetPath, true);

        for (const cand of candidates) {
          const cleanCand = cand.replace(/^\.\//, "");
          if (allFiles.has(cleanCand)) {
            return cleanCand;
          }
        }
      }
      return null;
    }

    const fromDir = dirname(fromFile);
    const joined = join(fromDir, importPath);
    const normalized = joined.replace(/\\/g, "/");

    const candidates = this.getImportCandidates(normalized, false);

    for (const cand of candidates) {
      const cleanCand = cand.replace(/^\.\//, "");
      if (allFiles.has(cleanCand)) {
        return cleanCand;
      }
    }

    return null;
  }

  private getImportCandidates(
    targetPath: string,
    includePackageEntrypoints: boolean,
  ): string[] {
    const withoutRuntimeExtension = targetPath.replace(
      /\.(?:mjs|cjs|js|jsx)$/i,
      "",
    );
    const bases = Array.from(new Set([targetPath, withoutRuntimeExtension]));
    const candidates = bases.flatMap((base) => [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      `${base}.d.ts`,
      join(base, "index.ts").replace(/\\/g, "/"),
      join(base, "index.tsx").replace(/\\/g, "/"),
      join(base, "index.js").replace(/\\/g, "/"),
      join(base, "index.jsx").replace(/\\/g, "/"),
    ]);
    if (includePackageEntrypoints) {
      candidates.push(
        join(withoutRuntimeExtension, "src/index.ts").replace(/\\/g, "/"),
        join(withoutRuntimeExtension, "src/index.tsx").replace(/\\/g, "/"),
        join(withoutRuntimeExtension, "src/index.js").replace(/\\/g, "/"),
        join(withoutRuntimeExtension, "src/main.ts").replace(/\\/g, "/"),
        join(withoutRuntimeExtension, "src/main.tsx").replace(/\\/g, "/"),
      );
    }
    return Array.from(new Set(candidates));
  }

  private computePageRank(
    files: Record<string, FileIndex>,
    resolvedEdges: Map<string, Set<string>>,
  ): Record<string, number> {
    const nodes = Object.keys(files);
    const N = nodes.length;
    if (N === 0) return {};

    let pr: Record<string, number> = {};
    for (const node of nodes) {
      pr[node] = 1 / N;
    }

    const damping = 0.85;
    const maxIterations = 20;
    const tol = 1e-4;

    const incoming: Record<string, string[]> = {};
    for (const node of nodes) {
      incoming[node] = [];
    }

    const outgoingCount: Record<string, number> = {};
    for (const node of nodes) {
      const targets = resolvedEdges.get(node) || new Set();
      outgoingCount[node] = targets.size;
      for (const target of targets) {
        if (incoming[target] !== undefined) {
          incoming[target].push(node);
        }
      }
    }

    for (let iter = 0; iter < maxIterations; iter++) {
      const nextPr: Record<string, number> = {};
      for (const node of nodes) {
        nextPr[node] = 0;
      }

      let danglingSum = 0;
      for (const node of nodes) {
        if (outgoingCount[node] === 0) {
          danglingSum += pr[node];
        }
      }

      for (const node of nodes) {
        let sum = (1 - damping) / N + (damping * danglingSum) / N;

        for (const source of incoming[node]) {
          const outDegree = outgoingCount[source];
          if (outDegree > 0) {
            sum += damping * (pr[source] / outDegree);
          }
        }

        nextPr[node] = sum;
      }

      let diff = 0;
      for (const node of nodes) {
        diff += Math.abs(nextPr[node] - pr[node]);
      }

      pr = nextPr;
      if (diff < tol) {
        break;
      }
    }

    return pr;
  }

  private parseSymbolIndex(raw: string): SymbolIndex | null {
    const parsed = SymbolIndexSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const files: Record<string, FileIndex> = {};
    for (const [filePath, fileIndex] of Object.entries(parsed.data.files)) {
      if (isAbsolute(filePath)) continue;
      try {
        resolveSafePath(this.cwd, filePath);
        files[filePath] = fileIndex;
      } catch {
        // Ignore cache entries that no longer resolve inside the workspace.
      }
    }
    return { ...parsed.data, files };
  }

  private initializeIndexPath(): void {
    this.indexPath = getOrbitCachePath(this.cwd, "symbols.json");
  }

  private parseFile(
    content: string,
    filePath: string,
  ): { symbols: SymbolEntry[]; imports: string[] } {
    const symbols: SymbolEntry[] = [];
    const imports: string[] = [];
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );

      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
          const specifier = node.moduleSpecifier;
          if (ts.isStringLiteral(specifier)) {
            imports.push(specifier.text);
          }
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
          const specifier = node.moduleSpecifier;
          if (ts.isStringLiteral(specifier)) {
            imports.push(specifier.text);
          }
        } else if (ts.isClassDeclaration(node) && node.name) {
          symbols.push({
            name: node.name.text,
            type: "class",
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
          });
        } else if (ts.isInterfaceDeclaration(node) && node.name) {
          symbols.push({
            name: node.name.text,
            type: "interface",
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
          });
        } else if (ts.isTypeAliasDeclaration(node) && node.name) {
          symbols.push({
            name: node.name.text,
            type: "type",
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
          });
        } else if (ts.isFunctionDeclaration(node) && node.name) {
          symbols.push({
            name: node.name.text,
            type: "function",
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
          });
        } else if (ts.isVariableStatement(node)) {
          const isExported = node.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword,
          );
          if (isExported) {
            for (const decl of node.declarationList.declarations) {
              if (ts.isIdentifier(decl.name)) {
                symbols.push({
                  name: decl.name.text,
                  type: "constant",
                  line:
                    sourceFile.getLineAndCharacterOfPosition(decl.getStart())
                      .line + 1,
                });
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch {
      // Fallback
    }

    return { symbols, imports };
  }
}
