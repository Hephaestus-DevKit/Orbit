import { z } from "zod";

export const ReviewPresetSchema = z.enum([
  "comprehensive",
  "security",
  "tests",
  "performance",
  "accessibility",
]);

export type ReviewPreset = z.infer<typeof ReviewPresetSchema>;

export const ReviewScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("working-tree") }),
  z.object({ kind: z.literal("commit"), ref: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("branch"), ref: z.string().min(1).max(200) }),
]);

export type ReviewScope = z.infer<typeof ReviewScopeSchema>;

export interface ReviewCommandRequest {
  preset: ReviewPreset;
  scope: ReviewScope;
  customInstructions?: string;
}

const SAFE_GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/@{}~^:+-]{0,199}$/;

/**
 * Convert `/review` arguments into a bounded, deterministic review request.
 */
export function parseReviewCommand(rawArguments: string): ReviewCommandRequest {
  const input = rawArguments.trim();
  if (!input) {
    return {
      preset: "comprehensive",
      scope: { kind: "working-tree" },
    };
  }

  const [first = "", ...rest] = input.split(/\s+/);
  const preset = ReviewPresetSchema.safeParse(first);
  if (preset.success) {
    return {
      preset: preset.data,
      scope: { kind: "working-tree" },
    };
  }

  if (first === "commit" || first === "branch") {
    const ref = rest.shift() || "";
    if (!SAFE_GIT_REF.test(ref)) {
      throw new Error(
        "Review refs may only contain standard Git ref characters.",
      );
    }
    const requestedPreset = rest.shift() || "comprehensive";
    if (rest.length > 0) {
      throw new Error("Too many /review arguments.");
    }
    return {
      preset: ReviewPresetSchema.parse(requestedPreset),
      scope: ReviewScopeSchema.parse({ kind: first, ref }),
    };
  }

  if (first === "custom") {
    const customInstructions = input.slice("custom".length).trim();
    if (!customInstructions || customInstructions.length > 4_000) {
      throw new Error(
        "Custom review instructions must contain 1 to 4000 characters.",
      );
    }
    return {
      preset: "comprehensive",
      scope: { kind: "working-tree" },
      customInstructions,
    };
  }

  throw new Error(
    "Usage: /review [comprehensive|security|tests|performance|accessibility|commit <ref> [preset]|branch <ref> [preset]|custom <instructions>]",
  );
}

/** Build the agent prompt used by both terminal and Web UI review launchers. */
export function buildReviewPrompt(request: ReviewCommandRequest): string {
  const scope =
    request.scope.kind === "working-tree"
      ? "the current uncommitted working tree against HEAD"
      : request.scope.kind === "commit"
        ? `commit ${request.scope.ref}`
        : `the current branch against ${request.scope.ref}`;
  const focus: Record<ReviewPreset, string> = {
    comprehensive:
      "correctness, security, regressions, tests, maintainability, performance, and accessibility where applicable",
    security:
      "exploitable security defects, unsafe trust boundaries, credential exposure, path traversal, injection, and permission bypasses",
    tests:
      "missing coverage, false-positive tests, flaky behavior, unverified failure paths, and release-contract gaps",
    performance:
      "startup latency, repeated I/O, memory growth, hot-loop work, cache invalidation, and avoidable serialization",
    accessibility:
      "keyboard navigation, focus management, semantic roles, readable status announcements, contrast assumptions, and responsive interaction",
  };
  const custom = request.customInstructions
    ? `\nAdditional review policy:\n${request.customInstructions}`
    : "";

  return [
    `Perform a dedicated ${request.preset} code review of ${scope}.`,
    `Prioritize ${focus[request.preset]}.`,
    "Inspect the relevant diff and surrounding code before reaching conclusions.",
    "Report only actionable findings. For each finding include severity (P0-P3), file and line, evidence, impact, and a precise remediation.",
    "Then provide a concise verification plan. Do not modify files unless the user explicitly asks for fixes.",
    custom,
  ]
    .filter(Boolean)
    .join("\n");
}
