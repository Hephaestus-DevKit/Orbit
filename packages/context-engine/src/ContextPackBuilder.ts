import { join } from "path";
import {
  estimateTokenCount,
  readBoundedRegularFile,
  truncateTextToTokenBudget,
} from "@orbit-build/shared";
import { ConfigLoader, type OrbitConfig } from "@orbit-build/config";
import { ActiveSkill, ContextPack, SkillSummary } from "./types.js";
import { ProjectIndexer } from "./ProjectIndexer.js";
import { FileSummarizer } from "./FileSummarizer.js";
import {
  CodebaseContextRetriever,
  selectCodebaseRetrievalMode,
} from "./CodebaseContextRetriever.js";
import {
  getWorkspaceRetrievalService,
  type WorkspaceRetrievalService,
} from "./WorkspaceRetrievalService.js";
import {
  discoverSkills,
  selectSkills,
  type RegisteredSkill,
  type SkillDiagnostic,
} from "./skills/index.js";

const SKILLS_CACHE_TTL_MS = 30_000;
const PROJECT_INSTRUCTIONS_MAX_BYTES = 1024 * 1024;
const MAX_RELEVANT_FILES = 64;
const FILE_SUMMARY_CONCURRENCY = 8;

export class ContextPackBuilder {
  private indexer: ProjectIndexer;
  private summarizer: FileSummarizer;
  private readonly retrieval: WorkspaceRetrievalService;
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
    this.retrieval = getWorkspaceRetrievalService(cwd);
  }

  /** Drop the discovery cache so a just-created skill is visible at once. */
  public invalidateSkillsCache(): void {
    this.skillsCache = undefined;
  }

  public async build(
    relevantFiles: Array<{ path: string; reason: string; readOnly?: boolean }>,
    userQuery?: string,
    options: { maxTokens?: number; forcedSkills?: string[] } = {},
  ): Promise<ContextPack> {
    const projectIndexPromise = this.indexer.index();
    const projectInstructionsPromise = this.loadInstructions();
    const config = ConfigLoader.loadSync(this.cwd);
    const skillsPromise = this.loadSkills(
      config,
      userQuery,
      options.forcedSkills,
    );

    let codebaseContextPromise: Promise<string | undefined> =
      Promise.resolve(undefined);
    const retrievalMode = selectCodebaseRetrievalMode(
      userQuery,
      config.context.autoCodebaseRetrieval,
    );
    if (userQuery && retrievalMode !== "off") {
      codebaseContextPromise = new CodebaseContextRetriever(
        this.cwd,
        this.retrieval,
      ).retrieve(userQuery, config, retrievalMode);
    }

    const packedFilesPromise = mapWithConcurrency(
      relevantFiles.slice(0, MAX_RELEVANT_FILES),
      FILE_SUMMARY_CONCURRENCY,
      async (f) => {
        const { summary, excerpt } = await this.summarizer.summarize(f.path);
        return {
          path: f.path,
          reason: f.reason,
          summary,
          excerpt,
          readOnly: f.readOnly,
        };
      },
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
        projectIndex,
        skillsIndex: skills.index,
        projectInstructions,
        codebaseContext,
        packedFiles,
        activeSkills: skills.active,
      },
      { maxTokens },
    );

    return {
      projectInstructions: fitted.projectInstructions,
      projectIndex: fitted.projectIndex,
      skillsIndex: fitted.skillsIndex,
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

  /** Coalesce codebase prewarming with any retrieval requested by this run. */
  public warmCodebaseRetrieval(): Promise<void> {
    return this.retrieval.warm();
  }

  /** Ensure the next retrieval observes successful workspace mutations. */
  public invalidateCodebaseRetrieval(): void {
    this.retrieval.invalidate();
  }

  /** Drain tracked indexing work before a short-lived workspace can close. */
  public settleBackgroundWork(): Promise<void> {
    return this.retrieval.settle();
  }

  private fitContextToBudget(
    source: {
      projectIndex: ContextPack["projectIndex"];
      skillsIndex: SkillSummary[];
      projectInstructions: string;
      codebaseContext?: string;
      packedFiles: ContextPack["relevantFiles"];
      activeSkills: ActiveSkill[];
    },
    metadata: {
      maxTokens: number;
    },
  ): typeof source & { usedEstimate: number } {
    const fitted = structuredClone(source);
    const estimate = () =>
      estimateTokenCount(
        JSON.stringify({
          projectIndex: fitted.projectIndex,
          projectInstructions: fitted.projectInstructions,
          packedFiles: fitted.packedFiles,
          codebaseContext: fitted.codebaseContext,
          skillsIndex: fitted.skillsIndex,
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

    while (usedEstimate > metadata.maxTokens && fitted.packedFiles.length > 0) {
      fitted.packedFiles.pop();
      usedEstimate = estimate();
    }
    while (usedEstimate > metadata.maxTokens) {
      const automaticIndex = fitted.activeSkills.findIndex(
        (skill) => skill.activation === "auto",
      );
      if (automaticIndex < 0) break;
      fitted.activeSkills.splice(automaticIndex, 1);
      usedEstimate = estimate();
    }
    while (usedEstimate > metadata.maxTokens && fitted.skillsIndex.length > 0) {
      fitted.skillsIndex.pop();
      usedEstimate = estimate();
    }
    if (usedEstimate > metadata.maxTokens) {
      fitted.codebaseContext = undefined;
      fitted.projectInstructions = "";
      fitted.projectIndex = {
        ...fitted.projectIndex,
        root: ".",
        entrypoints: fitted.projectIndex.entrypoints.slice(0, 8),
        importantFiles: fitted.projectIndex.importantFiles.slice(0, 8),
        ignoredFiles: [],
      };
      usedEstimate = estimate();
    }
    if (usedEstimate > metadata.maxTokens) {
      throw new Error(
        `Context metadata requires ${usedEstimate} estimated tokens, exceeding the hard budget of ${metadata.maxTokens}.`,
      );
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
    forcedSkills: string[] = [],
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
    const forcedQuery = forcedSkills.length
      ? `${userQuery || ""} ${forcedSkills.map((name) => `$${name}`).join(" ")}`
      : userQuery;
    return {
      // The always-in-context index advertises only enabled skills, and only
      // the fields the prompt renders — not byte accounting or UI metadata.
      index: skills
        .filter((skill) => !skill.disabled)
        .map(({ name, description, path }) => ({ name, description, path })),
      active: selectSkills(skills, forcedQuery, skillsConfig),
      diagnostics,
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await mapper(values[index]);
      }
    }),
  );
  return results;
}
