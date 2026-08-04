import type { OrbitConfig } from "@orbit-build/config";

export type AgentReviewerPerspective =
  | "correctness"
  | "security"
  | "testing"
  | "performance";

export interface AgentReviewerProfile {
  perspective: AgentReviewerPerspective;
  instruction: string;
  canRunCommands: boolean;
}

export interface ResolvedAgentTeam {
  preset: OrbitConfig["agent"]["teamPreset"];
  maxAttempts: number;
  maxReviewConcurrency: number;
  reviewers: AgentReviewerProfile[];
}

const REVIEWERS: Record<AgentReviewerPerspective, AgentReviewerProfile> = {
  correctness: {
    perspective: "correctness",
    instruction:
      "Review correctness, regressions, tests, and verification evidence.",
    canRunCommands: true,
  },
  security: {
    perspective: "security",
    instruction:
      "Review security, workspace boundaries, credential handling, dependencies, and destructive edge cases.",
    canRunCommands: false,
  },
  testing: {
    perspective: "testing",
    instruction:
      "Review test coverage, failure paths, platform compatibility, and run the smallest relevant verification set.",
    canRunCommands: true,
  },
  performance: {
    perspective: "performance",
    instruction:
      "Review latency, memory, I/O, concurrency, caching, and avoid speculative optimization without evidence.",
    canRunCommands: true,
  },
};

const PRESETS: Record<
  OrbitConfig["agent"]["teamPreset"],
  AgentReviewerPerspective[]
> = {
  fast: ["correctness"],
  balanced: ["correctness", "security"],
  thorough: ["correctness", "security", "testing", "performance"],
};

/** Resolve one provider-neutral, bounded team recipe from validated config. */
export function resolveAgentTeam(config: OrbitConfig): ResolvedAgentTeam {
  const preset = config.agent.teamPreset;
  const reviewers = PRESETS[preset].map((perspective) => ({
    ...REVIEWERS[perspective],
  }));
  return {
    preset,
    maxAttempts: config.agent.maxReviewAttempts,
    maxReviewConcurrency: Math.min(
      reviewers.length,
      config.agent.maxReviewConcurrency,
    ),
    reviewers,
  };
}
