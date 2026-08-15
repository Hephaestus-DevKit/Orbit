import type { OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { redactSecrets, truncateTextToTokenBudget } from "@orbit-build/shared";
import { ReferencesRetriever } from "./ReferencesRetriever.js";
import { getEmbeddingProvider } from "./SymbolIndexer.js";
import {
  getWorkspaceRetrievalService,
  type WorkspaceRetrievalService,
} from "./WorkspaceRetrievalService.js";

const CODEBASE_FORCE_MARKER = /@codebase\b/i;
const CODEBASE_DISABLE_MARKER = /@no-codebase\b/i;
const CODEBASE_FORCE_MARKER_ALL = /@codebase\b/gi;
const CODEBASE_DISABLE_MARKER_ALL = /@no-codebase\b/gi;
const CODE_INTENT =
  /\b(?:implement|fix|debug|refactor|review|inspect|trace|codebase|repository|repo|function|class|module|dependency|build|test|error|stack\s*trace)\b|(?:实现|修改|修复|调试|重构|审查|检查|代码|项目|仓库|函数|类|模块|依赖|构建|测试|报错|异常|架构)/i;
const SOURCE_REFERENCE =
  /(?:^|[\s`'"(])[^\s`'"()]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|py|pyw)(?=$|[\s`'"),:])/i;

export type CodebaseRetrievalMode = "off" | "explicit" | "automatic";

interface CodebaseContextBudget {
  queryTokens: number;
  searchTokens: number;
  referenceTokens: number;
  repoMapTokens: number;
  totalTokens: number;
  resultLimit: number;
  referencesPerSymbol: number;
  totalReferences: number;
}

const CODEBASE_CONTEXT_BUDGETS: Record<
  Exclude<CodebaseRetrievalMode, "off">,
  CodebaseContextBudget
> = {
  automatic: {
    queryTokens: 256,
    searchTokens: 3_072,
    referenceTokens: 1_024,
    repoMapTokens: 512,
    totalTokens: 6_144,
    resultLimit: 4,
    referencesPerSymbol: 2,
    totalReferences: 6,
  },
  explicit: {
    queryTokens: 512,
    searchTokens: 8_192,
    referenceTokens: 4_096,
    repoMapTokens: 2_048,
    totalTokens: 16_384,
    resultLimit: 8,
    referencesPerSymbol: 3,
    totalReferences: 12,
  },
};

/** Decide whether repository retrieval is relevant without forcing it on chat. */
export function selectCodebaseRetrievalMode(
  userQuery: string | undefined,
  autoEnabled: boolean,
): CodebaseRetrievalMode {
  if (!userQuery || CODEBASE_DISABLE_MARKER.test(userQuery)) return "off";
  if (CODEBASE_FORCE_MARKER.test(userQuery)) {
    return "explicit";
  }
  if (!autoEnabled) return "off";
  return CODE_INTENT.test(userQuery) || SOURCE_REFERENCE.test(userQuery)
    ? "automatic"
    : "off";
}

export function cleanCodebaseQuery(userQuery: string): string {
  return userQuery
    .replace(CODEBASE_FORCE_MARKER_ALL, "")
    .replace(CODEBASE_DISABLE_MARKER_ALL, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Builds bounded repo-map, hybrid-search, and reference context for one turn. */
export class CodebaseContextRetriever {
  public constructor(
    private readonly cwd: string,
    private readonly retrieval: WorkspaceRetrievalService = getWorkspaceRetrievalService(
      cwd,
    ),
  ) {}

  public async retrieve(
    userQuery: string,
    config: OrbitConfig,
    mode: Exclude<CodebaseRetrievalMode, "off">,
  ): Promise<string> {
    const budget = CODEBASE_CONTEXT_BUDGETS[mode];
    const cleanQuery = cleanCodebaseQuery(userQuery);
    const searchQuery = truncateTextToTokenBudget(
      cleanQuery || "repository architecture and entrypoints",
      budget.queryTokens,
    );
    const prepared = await this.retrieval.prepare(budget.repoMapTokens);
    let chunksText = "";
    let referencesText = "";
    try {
      let provider: ModelProvider | null = null;
      try {
        provider = getEmbeddingProvider(config);
      } catch {
        // BM25 remains available without an embedding provider.
      }

      const embedFn = async (texts: string[]): Promise<number[][]> => {
        if (!provider?.embed)
          throw new Error("No embedding provider available");
        const modelName = config.models?.embedding || "text-embedding-3-small";
        return provider.embed(texts, { model: modelName });
      };
      const results = await prepared.search.search(searchQuery, embedFn, {
        limit: budget.resultLimit,
      });
      if (results.length > 0) {
        chunksText = truncateTextToTokenBudget(
          results
            .map(
              (result, index) =>
                `--- Search Match #${index + 1} (Score: ${result.hybridScore.toFixed(4)}) ---\n` +
                `${result.text}\n`,
            )
            .join("\n"),
          budget.searchTokens,
        );
        const referencedSymbols = Array.from(
          new Set(
            results
              .map((result) => result.metadata.symbolName)
              .filter((name): name is string => Boolean(name)),
          ),
        );
        if (referencedSymbols.length > 0) {
          referencesText = await new ReferencesRetriever(
            this.cwd,
          ).getReferencesContext(
            referencedSymbols,
            budget.referencesPerSymbol,
            budget.totalReferences,
          );
          referencesText = truncateTextToTokenBudget(
            referencesText,
            budget.referenceTokens,
          );
        }
      } else {
        chunksText = "(No relevant code matches found in search index.)\n";
      }
    } catch (error: unknown) {
      const message = redactSecrets(
        error instanceof Error ? error.message : String(error),
      )
        .replace(/[\r\n]+/g, " ")
        .slice(0, 500);
      chunksText = `(RAG retrieval failed: ${message})\n`;
    }

    const repoMap = truncateTextToTokenBudget(
      prepared.repoMap || "(No landmarks mapped.)",
      budget.repoMapTokens,
    );
    const context =
      `=== ${mode === "explicit" ? "Requested" : "Automatic"} Codebase Search Context for Query: "${searchQuery}" ===\n` +
      "Use the following repository evidence when it is relevant; verify files before editing.\n\n" +
      `${chunksText}\n${referencesText}` +
      `=== Codebase Landmark Repo Map ===\n` +
      `${repoMap}\n` +
      "================================================================";
    return truncateTextToTokenBudget(context, budget.totalTokens);
  }
}
