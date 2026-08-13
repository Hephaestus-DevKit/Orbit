import { existsSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import {
  estimateTokenCount,
  readBoundedRegularFile,
  replacePrivateFileAtomically,
} from "@orbit-build/shared";
import { ContextPack } from "@orbit-build/context-engine";
import {
  toolDefinitionsFingerprint,
  type OrbitToolDefinition,
} from "@orbit-build/model-providers";
import { z } from "zod";

export interface PromptCacheSlabInput {
  cwd: string;
  provider: string;
  model: string;
  baseSystemPrompt: string;
  toolsPrompt: string;
  tools?: readonly OrbitToolDefinition[];
  repoMapText: string;
  contextPack: ContextPack;
}

export interface PromptCacheSlab {
  hash: string;
  systemHash: string;
  toolSchemaHash: string;
  provider: string;
  model: string;
  text: string;
  tokenEstimate: number;
  path: string;
}

export interface PromptCacheTelemetrySample {
  recordedAt: string;
  inputTokens: number;
  hitTokens: number;
  missTokens: number;
  hitRate: number;
  degraded: boolean;
}

export interface PromptCacheSlabMetadata {
  hash?: string;
  provider?: string;
  model?: string;
  tokenEstimate?: number;
  systemHash?: string;
  toolSchemaHash?: string;
  /** Legacy field retained only to sort metadata written by older releases. */
  lastPrimedAt?: string;
  telemetry?: PromptCacheTelemetrySample[];
}

const PROMPT_CACHE_METADATA_MAX_BYTES = 256 * 1024;
const PROMPT_CACHE_MAX_FILES = 1_000;

export const PromptCacheTelemetrySampleSchema = z.object({
  recordedAt: z.string().max(100),
  inputTokens: z.number().int().nonnegative(),
  hitTokens: z.number().int().nonnegative(),
  missTokens: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1),
  degraded: z.boolean(),
});

export const PromptCacheSlabMetadataSchema = z
  .object({
    hash: z.string().max(128).optional(),
    provider: z.string().max(1_024).optional(),
    model: z.string().max(1_024).optional(),
    tokenEstimate: z.number().int().nonnegative().optional(),
    systemHash: z.string().max(128).optional(),
    toolSchemaHash: z.string().max(128).optional(),
    lastPrimedAt: z.string().max(100).optional(),
    telemetry: z.array(PromptCacheTelemetrySampleSchema).max(100).optional(),
  })
  .passthrough();

/** Read bounded, validated prompt-cache metadata without following links. */
export function readPromptCacheSlabMetadata(
  path: string,
): PromptCacheSlabMetadata | undefined {
  try {
    const raw = readBoundedRegularFile(path, PROMPT_CACHE_METADATA_MAX_BYTES);
    if (raw === undefined) return undefined;
    return PromptCacheSlabMetadataSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export class PromptCacheSlabBuilder {
  public static build(input: PromptCacheSlabInput): PromptCacheSlab {
    const stableText = this.buildStableText(input);
    const systemHash = createHash("sha256").update(stableText).digest("hex");
    const toolSchemaHash = toolDefinitionsFingerprint(input.tools);
    const hash = createHash("sha256")
      .update(
        [
          "orbit-cache-prefix-v3",
          input.provider,
          input.model,
          systemHash,
          toolSchemaHash,
        ].join("\n"),
      )
      .digest("hex");
    const slabPath = join(
      input.cwd,
      ".orbit",
      "cache-slabs",
      `${hash.slice(0, 24)}.json`,
    );

    return {
      hash,
      systemHash,
      toolSchemaHash,
      provider: input.provider,
      model: input.model,
      text: stableText,
      tokenEstimate: estimateTokenCount(stableText),
      path: slabPath,
    };
  }

  public static recordTelemetry(
    slab: PromptCacheSlab,
    sample: Omit<PromptCacheTelemetrySample, "recordedAt">,
    date = new Date(),
  ): void {
    const existing = readPromptCacheSlabMetadata(slab.path);
    const telemetry = [
      ...(existing?.telemetry || []),
      {
        recordedAt: date.toISOString(),
        ...sample,
      },
    ].slice(-20);
    this.save(slab, telemetry);
  }

  public static hasTelemetry(slab: PromptCacheSlab): boolean {
    return (readPromptCacheSlabMetadata(slab.path)?.telemetry?.length || 0) > 0;
  }

  public static buildDiagnostics(cwd: string): string {
    const dir = join(cwd, ".orbit", "cache-slabs");
    if (!existsSync(dir)) {
      return [
        "Cache diagnostics:",
        "- No cache slab metadata found yet.",
        "- Run at least one DeepSeek request to create a stable slab.",
      ].join("\n");
    }

    const slabs = readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .slice(0, PROMPT_CACHE_MAX_FILES)
      .map((file) => readPromptCacheSlabMetadata(join(dir, file)))
      .filter((meta): meta is PromptCacheSlabMetadata => Boolean(meta?.hash))
      .sort((a, b) => {
        const aTime = Date.parse(
          a.telemetry?.at(-1)?.recordedAt || a.lastPrimedAt || "",
        );
        const bTime = Date.parse(
          b.telemetry?.at(-1)?.recordedAt || b.lastPrimedAt || "",
        );
        return (
          (Number.isFinite(bTime) ? bTime : 0) -
          (Number.isFinite(aTime) ? aTime : 0)
        );
      });

    if (slabs.length === 0) {
      return "Cache diagnostics:\n- No readable cache slab metadata found.";
    }

    const lines = ["Cache diagnostics:"];
    for (const slab of slabs.slice(0, 5)) {
      const samples = slab.telemetry || [];
      const recent = samples.at(-1);
      const avgHit =
        samples.length > 0
          ? samples.reduce((sum, item) => sum + item.hitRate, 0) /
            samples.length
          : undefined;
      lines.push(
        `- slab ${String(slab.hash).slice(0, 8)} provider=${slab.provider || "legacy"} model=${slab.model || "unknown"} system=${String(slab.systemHash || "unknown").slice(0, 8)} tools=${String(slab.toolSchemaHash || "unknown").slice(0, 8)} tokens=${slab.tokenEstimate || 0} observations=${samples.length}`,
      );
      if (recent) {
        lines.push(
          `  recent hit=${Math.round(recent.hitRate * 100)}% (${recent.hitTokens}/${recent.inputTokens}) miss=${recent.missTokens} degraded=${recent.degraded ? "yes" : "no"} at=${recent.recordedAt}`,
        );
      }
      if (avgHit !== undefined) {
        lines.push(
          `  trend samples=${samples.length} avgHit=${Math.round(avgHit * 100)}%`,
        );
      }
    }
    return lines.join("\n");
  }

  private static save(
    slab: PromptCacheSlab,
    telemetry?: PromptCacheTelemetrySample[],
  ): void {
    try {
      const existing = readPromptCacheSlabMetadata(slab.path);
      replacePrivateFileAtomically(
        slab.path,
        JSON.stringify(
          {
            hash: slab.hash,
            systemHash: slab.systemHash,
            toolSchemaHash: slab.toolSchemaHash,
            provider: slab.provider,
            model: slab.model,
            tokenEstimate: slab.tokenEstimate,
            telemetry: telemetry || existing?.telemetry || [],
          },
          null,
          2,
        ),
      );
    } catch {
      // Cache metadata must never block agent execution.
    }
  }

  private static buildStableText(input: PromptCacheSlabInput): string {
    const ctx = input.contextPack;
    const sortedLanguages = [...ctx.projectIndex.detectedLanguages].sort();
    const sortedFrameworks = [...ctx.projectIndex.frameworks].sort();
    const sortedEntrypoints = [...ctx.projectIndex.entrypoints].sort();
    const skillsIndex = (ctx.skillsIndex || [])
      .slice()
      .sort((left, right) => {
        const byName = left.name.localeCompare(right.name, "en");
        return byName !== 0
          ? byName
          : left.path.localeCompare(right.path, "en");
      })
      .map((skill) => {
        const description = skill.description
          ? ` - ${skill.description.replace(/\s+/g, " ").trim()}`
          : "";
        return `- ${skill.name}${description}`;
      })
      .join("\n");

    const stableWorkspace = [
      "### Orbit Stable Prompt Profile",
      `Model lane: ${input.model}`,
      "Cache policy: Keep this system prefix byte-stable across turns; persist turn context in message history.",
      "",
      "### Workspace Stable Profile",
      `Language profile: ${sortedLanguages.join(", ")}`,
      `Framework profile: ${sortedFrameworks.join(", ") || "None"}`,
      `Entrypoints: ${sortedEntrypoints.join(", ") || "None"}`,
      `PM: ${ctx.projectIndex.packageManager || "None"}`,
      skillsIndex ? `\n### Available Skills\n${skillsIndex}` : "",
      ctx.projectInstructions
        ? `\n### Project Instructions\n${ctx.projectInstructions.replace(/\r\n/g, "\n").replace(/\r/g, "\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return [
      input.baseSystemPrompt.trimEnd(),
      input.toolsPrompt.trimEnd(),
      stableWorkspace.trimEnd(),
    ].join("\n\n");
  }
}
