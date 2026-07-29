import { join } from "path";
import {
  estimateTokenCount,
  readBoundedRegularFile,
  truncateTextToTokenBudget,
} from "@orbit-build/shared";
import { ConfigLoader, type OrbitConfig } from "@orbit-build/config";
import type { ModelProvider } from "@orbit-build/model-providers";
import { ActiveSkill, ContextPack, SkillSummary } from "./types.js";
import { ProjectIndexer } from "./ProjectIndexer.js";
import { FileSummarizer } from "./FileSummarizer.js";
import { SymbolIndexer, getEmbeddingProvider } from "./SymbolIndexer.js";
import { HybridSearch } from "./HybridSearch.js";
import { ReferencesRetriever } from "./ReferencesRetriever.js";
import {
  discoverSkills,
  selectSkills,
  type RegisteredSkill,
  type SkillDiagnostic,
} from "./skills/index.js";

const SKILLS_CACHE_TTL_MS = 30_000;
const PROJECT_INSTRUCTIONS_MAX_BYTES = 1024 * 1024;

export class ContextPackBuilder {
  private indexer: ProjectIndexer;
  private summarizer: FileSummarizer;
  private skillsCache:
    | {
        key: string;
        loadedAt: number;
        skills: RegisteredSkill[];
        diagnostics: SkillDiagnostic[];
      }
    | undefined;

  constructor(private cwd: string) {
    this.indexer = new ProjectIndexer(cwd);
    this.summarizer = new FileSummarizer(cwd);
  }

  /** Drop the discovery cache so a just-created skill is visible at once. */
  public invalidateSkillsCache(): void {
    this.skillsCache = undefined;
  }

  public async build(
    relevantFiles: Array<{ path: string; reason: string; readOnly?: boolean }>,
    userQuery?: string,
    options: { maxTokens?: number } = {},
  ): Promise<ContextPack> {
    const projectIndexPromise = this.indexer.index();
    const projectInstructionsPromise = this.loadInstructions();
    const config = ConfigLoader.loadSync(this.cwd);
    const skillsPromise = this.loadSkills(config, userQuery);

    // Check if query contains @codebase
    let codebaseContextPromise: Promise<string | undefined> =
      Promise.resolve(undefined);
    if (userQuery && userQuery.includes("@codebase")) {
      const cleanQuery = userQuery.replace(/@codebase/g, "").trim();

      codebaseContextPromise = (async () => {
        const symbolIndexer = new SymbolIndexer(this.cwd);
        // Run quick incremental index to make sure RAG has latest files
        await symbolIndexer.index();

        // Get Repo Map Landmark Text
        const repoMap = await symbolIndexer.getRepoMapText(2048);

        // Perform Hybrid Search
        const hybridSearch = new HybridSearch(this.cwd);
        let chunksText = "";
        let referencesText = "";
        try {
          let provider: ModelProvider | null = null;
          try {
            provider = getEmbeddingProvider(config);
          } catch {
            // Ignore, provider stays null
          }

          const embedFn = async (texts: string[]) => {
            if (provider?.embed) {
              const modelName =
                config.models?.embedding || "text-embedding-3-small";
              return await provider.embed(texts, { model: modelName });
            }
            throw new Error("No embedding provider available");
          };

          const results = await hybridSearch.search(
            cleanQuery || "codebase search",
            embedFn,
            { limit: 5 },
          );
          if (results.length > 0) {
            chunksText = results
              .map((res, idx) => {
                return (
                  `--- Search Match #${idx + 1} (Score: ${res.hybridScore.toFixed(4)}) ---\n` +
                  `${res.text}\n`
                );
              })
              .join("\n");

            // Symbol references graph walk RAG
            const referencedSymbols = new Set<string>();
            for (const res of results) {
              if (res.metadata.symbolName) {
                referencedSymbols.add(res.metadata.symbolName);
              }
            }

            if (referencedSymbols.size > 0) {
              const retriever = new ReferencesRetriever(this.cwd);
              referencesText = await retriever.getReferencesContext(
                Array.from(referencedSymbols),
              );
            }
          } else {
            chunksText = "(No relevant code matches found in search index.)\n";
          }
        } catch (e) {
          chunksText = `(RAG retrieval failed: ${(e as Error).message})\n`;
        }

        return (
          `=== RAG Codebase Search Context for Query: "${cleanQuery}" ===\n` +
          `Use the following relevant code snippets retrieved from the repository to answer questions:\n\n` +
          `${chunksText}\n` +
          `${referencesText}` +
          `=== Codebase Landmark Repo Map ===\n` +
          `${repoMap || "(No landmarks mapped.)"}\n` +
          `================================================================`
        );
      })();
    }

    const packedFilesPromise = Promise.all(
      relevantFiles.map(async (f) => {
        const { summary, excerpt } = await this.summarizer.summarize(f.path);
        return {
          path: f.path,
          reason: f.reason,
          summary,
          excerpt,
          readOnly: f.readOnly,
        };
      }),
    );

    const [
      projectIndex,
      projectInstructions,
      codebaseContext,
      packedFiles,
      skills,
    ] = await Promise.all([
      projectIndexPromise,
      projectInstructionsPromise,
      codebaseContextPromise,
      packedFilesPromise,
      skillsPromise,
    ]);

    const maxTokens = Math.max(256, Math.floor(options.maxTokens ?? 128_000));
    const fitted = this.fitContextToBudget(
      {
        projectInstructions,
        codebaseContext,
        packedFiles,
        activeSkills: skills.active,
      },
      { projectIndex, skillsIndex: skills.index, maxTokens },
    );

    return {
      projectInstructions: fitted.projectInstructions,
      projectIndex,
      skillsIndex: skills.index,
      activeSkills: fitted.activeSkills,
      skillDiagnostics: skills.diagnostics,
      relevantFiles: fitted.packedFiles,
      recentChanges: "",
      currentDiff: "",
      previousErrors: "",
      codebaseContext: fitted.codebaseContext,
      tokenBudget: {
        max: maxTokens,
        usedEstimate: fitted.usedEstimate,
      },
    };
  }

  private fitContextToBudget(
    source: {
      projectInstructions: string;
      codebaseContext?: string;
      packedFiles: ContextPack["relevantFiles"];
      activeSkills: ActiveSkill[];
    },
    metadata: {
      projectIndex: ContextPack["projectIndex"];
      skillsIndex: SkillSummary[];
      maxTokens: number;
    },
  ): typeof source & { usedEstimate: number } {
    const fitted = structuredClone(source);
    const estimate = () =>
      estimateTokenCount(
        JSON.stringify({
          projectIndex: metadata.projectIndex,
          projectInstructions: fitted.projectInstructions,
          packedFiles: fitted.packedFiles,
          codebaseContext: fitted.codebaseContext,
          skillsIndex: metadata.skillsIndex,
          activeSkills: fitted.activeSkills,
        }),
      );
    let usedEstimate = estimate();

    for (
      let pass = 0;
      usedEstimate > metadata.maxTokens && pass < 100;
      pass++
    ) {
      const candidates: Array<{
        tokens: number;
        apply(maxTokens: number): void;
      }> = [];
      const addCandidate = (
        text: string | undefined,
        apply: (next: string) => void,
      ) => {
        if (!text) return;
        const tokens = estimateTokenCount(text);
        if (tokens <= 16) return;
        candidates.push({
          tokens,
          apply: (target) => apply(truncateTextToTokenBudget(text, target)),
        });
      };

      addCandidate(fitted.codebaseContext, (text) => {
        fitted.codebaseContext = text;
      });
      addCandidate(fitted.projectInstructions, (text) => {
        fitted.projectInstructions = text;
      });
      for (const file of fitted.packedFiles) {
        addCandidate(file.excerpt, (text) => {
          file.excerpt = text;
        });
      }
      for (const skill of fitted.activeSkills) {
        addCandidate(skill.content, (text) => {
          skill.content = text;
          skill.loadedBytes = Buffer.byteLength(text, "utf8");
          skill.truncated = true;
        });
      }

      const largest = candidates.sort(
        (left, right) => right.tokens - left.tokens,
      )[0];
      if (!largest) break;
      const excess = usedEstimate - metadata.maxTokens;
      largest.apply(Math.max(16, largest.tokens - Math.max(excess + 16, 64)));
      const nextEstimate = estimate();
      if (nextEstimate >= usedEstimate) break;
      usedEstimate = nextEstimate;
    }

    return { ...fitted, usedEstimate };
  }

  private async loadInstructions(): Promise<string> {
    const candidates = [
      "ORBIT.md",
      ".agents/AGENTS.md",
      "AGENTS.md",
      "CLAUDE.md",
      "RUNE.md",
      ".cursorrules",
      ".copilotrules",
      "README.md",
    ];
    for (const name of candidates) {
      const p = join(this.cwd, ...name.split("/"));
      try {
        const content = readBoundedRegularFile(
          p,
          PROJECT_INSTRUCTIONS_MAX_BYTES,
        );
        if (content !== undefined) return content;
      } catch {
        // Ignored
      }
    }
    return "";
  }

  private async loadSkills(
    config: OrbitConfig,
    userQuery?: string,
  ): Promise<{
    index: SkillSummary[];
    active: ActiveSkill[];
    diagnostics: SkillDiagnostic[];
  }> {
    const skillsConfig = config.skills;
    if (skillsConfig.enabled === false) {
      return { index: [], active: [], diagnostics: [] };
    }

    const directories = Array.isArray(skillsConfig.directories)
      ? skillsConfig.directories
      : [];
    if (directories.length === 0) {
      return { index: [], active: [], diagnostics: [] };
    }

    const cacheKey = JSON.stringify({
      dirs: directories,
      maxBytes: skillsConfig.maxSkillBytes,
      disabled: skillsConfig.disabled,
    });
    const now = Date.now();
    if (
      !this.skillsCache ||
      this.skillsCache.key !== cacheKey ||
      now - this.skillsCache.loadedAt >= SKILLS_CACHE_TTL_MS
    ) {
      const catalog = await discoverSkills(this.cwd, skillsConfig);
      this.skillsCache = {
        key: cacheKey,
        loadedAt: now,
        skills: catalog.skills,
        diagnostics: catalog.diagnostics,
      };
    }

    const { skills, diagnostics } = this.skillsCache;
    return {
      // The always-in-context index advertises only enabled skills, and only
      // the fields the prompt renders — not byte accounting or UI metadata.
      index: skills
        .filter((skill) => !skill.disabled)
        .map(({ name, description, path }) => ({ name, description, path })),
      active: selectSkills(skills, userQuery, skillsConfig),
      diagnostics,
    };
  }
}
