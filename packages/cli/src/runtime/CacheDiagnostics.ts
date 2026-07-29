import { existsSync, readdirSync } from "fs";
import { join } from "path";
import picocolors from "picocolors";
import {
  readPromptCacheSlabMetadata,
  type PromptCacheSlabMetadata,
} from "@orbit-build/core";

const CACHE_DIAGNOSTIC_MAX_FILES = 1_000;

function latestObservation(metadata: PromptCacheSlabMetadata): string {
  return metadata.telemetry?.at(-1)?.recordedAt || metadata.lastPrimedAt || "";
}

export function buildCacheDiagnostics(cwd: string): string {
  const dir = join(cwd, ".orbit", "cache-slabs");
  if (!existsSync(dir)) {
    return picocolors.gray(
      "● No cache telemetry yet. It will appear after a completed DeepSeek request.",
    );
  }

  const slabs = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .slice(0, CACHE_DIAGNOSTIC_MAX_FILES)
    .map((file) => readPromptCacheSlabMetadata(join(dir, file)))
    .filter((item): item is PromptCacheSlabMetadata => Boolean(item))
    .sort((a, b) => latestObservation(b).localeCompare(latestObservation(a)))
    .slice(0, 5);

  if (slabs.length === 0) {
    return picocolors.gray(
      "● No readable cache slab metadata found. Remove stale .orbit/cache-slabs entries if this persists.",
    );
  }

  const lines: string[] = [];
  if (slabs.length > 1) {
    const latest = slabs[0];
    const previous = slabs[1];
    const tokenDelta =
      (latest.tokenEstimate || 0) - (previous.tokenEstimate || 0);
    const tokenDeltaText =
      tokenDelta === 0 ? "0t" : `${tokenDelta > 0 ? "+" : ""}${tokenDelta}t`;
    const sameHash =
      Boolean(latest.hash && previous.hash) && latest.hash === previous.hash;
    lines.push(
      picocolors.gray(
        `● Cache slab churn: ${slabs.length} retained, latest vs previous stable delta ${tokenDeltaText}, hash ${sameHash ? "unchanged" : "changed"}.`,
      ),
    );
  }
  for (const slab of slabs) {
    const samples = (slab.telemetry || []).slice(-5);
    const latest = samples.at(-1);
    const trend =
      samples.length > 1
        ? samples.reduce((sum, sample) => sum + sample.hitRate, 0) /
          samples.length
        : latest?.hitRate;
    // A cold baseline must not keep the slab yellow after later requests warm.
    const degraded = latest?.degraded ?? false;
    const label = `${slab.hash || "unknown"} model=${slab.model || "unknown"} stable=${slab.tokenEstimate || 0}t`;

    if (!latest) {
      lines.push(
        picocolors.gray(
          `● ${label}: no request telemetry yet${slab.lastPrimedAt ? ` (legacy metadata ${slab.lastPrimedAt})` : ""}.`,
        ),
      );
      continue;
    }

    const color =
      degraded || latest.hitRate < 0.55 ? picocolors.yellow : picocolors.green;
    lines.push(
      color(
        `● ${label}: latest ${Math.round(latest.hitRate * 100)}% hit, recent avg ${Math.round(
          (trend || 0) * 100,
        )}% (${latest.hitTokens}/${latest.inputTokens} tokens).`,
      ),
    );
  }

  return lines.join("\n");
}
