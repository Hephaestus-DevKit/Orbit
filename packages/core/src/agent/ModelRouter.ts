import { z } from "zod";

const RoutingInputSchema = z.object({
  query: z.string(),
  defaultModel: z.string().min(1),
  fastModel: z.string().min(1).optional(),
  qualityModel: z.string().min(1).optional(),
  lockedModel: z.string().min(1).optional(),
  fallbackModel: z.string().min(1).optional(),
  activeModel: z.string().min(1).optional(),
  repairTurn: z.boolean().default(false),
  hasWrittenFiles: z.boolean().default(false),
  affectedFileCount: z.number().int().min(0).max(100_000).default(0),
  verificationFailureCount: z.number().int().min(0).max(1000).default(0),
  estimatedContextTokens: z.number().int().min(0).optional(),
});

export type ModelRoutingInput = z.input<typeof RoutingInputSchema>;

export interface ModelRoutingDecision {
  model: string;
  lane: "locked" | "fallback" | "fast" | "balanced" | "quality";
  reason:
    | "user_locked"
    | "provider_fallback"
    | "verification_repair"
    | "complex_request"
    | "simple_request"
    | "write_escalation"
    | "continue_active_lane"
    | "default_lane";
  confidence: "high" | "medium";
}

const COMPLEX_SIGNALS = [
  "debug",
  "investigate",
  "root cause",
  "race condition",
  "architecture",
  "refactor",
  "migrate",
  "tradeoff",
  "optimize",
  "security",
  "vulnerability",
  "concurrency",
  "deadlock",
  "memory leak",
  "diagnose",
  "evaluate",
  "推理",
  "分析",
  "诊断",
  "调试",
  "设计",
  "评估",
  "为什么",
  "死锁",
  "内存泄漏",
  "并发",
  "优化",
  "重构",
  "安全",
  "漏洞",
  "架构",
  "崩溃",
  "故障",
] as const;

const SIMPLE_SIGNALS = [
  "what is",
  "list",
  "show",
  "rename",
  "lint",
  "format",
  "thanks",
  "continue",
  "search",
  "find",
  "什么是",
  "列出",
  "显示",
  "重命名",
  "格式化",
  "谢谢",
  "继续",
] as const;

export type TaskComplexity = "simple" | "balanced" | "complex";

/** Classifies reasoning budget independently from the selected model lane. */
export function classifyTaskComplexity(input: {
  query: string;
  repairTurn?: boolean;
  hasWrittenFiles?: boolean;
  affectedFileCount?: number;
  verificationFailureCount?: number;
  estimatedContextTokens?: number;
}): TaskComplexity {
  if (
    input.repairTurn ||
    (input.verificationFailureCount ?? 0) > 0 ||
    (input.affectedFileCount ?? 0) >= 3 ||
    (input.estimatedContextTokens ?? 0) >= 64_000
  ) {
    return "complex";
  }
  const query = input.query.toLowerCase().trim();
  const complex = COMPLEX_SIGNALS.some((signal) => query.includes(signal));
  const referencedFiles = new Set(
    query.match(/[\w@.-]+(?:\/[\w@.-]+)+\.[a-z0-9]+/gi) ?? [],
  ).size;
  const structuralComplexity =
    referencedFiles >= 3 ||
    query.length >= 600 ||
    (query.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/g) ?? []).length >= 4 ||
    /```[\s\S]*```/.test(query);
  if (complex || structuralComplexity) return "complex";
  const simpleSignal = SIMPLE_SIGNALS.some((signal) => query.includes(signal));
  const wordCount = query.split(/\s+/u).filter(Boolean).length;
  if (
    !input.hasWrittenFiles &&
    (simpleSignal || (wordCount <= 8 && query.length <= 80))
  ) {
    return "simple";
  }
  return "balanced";
}

/** Selects an explainable model lane without mutating runtime state. */
export function routeModel(input: ModelRoutingInput): ModelRoutingDecision {
  const value = RoutingInputSchema.parse(input);
  const qualityModel = value.qualityModel || value.defaultModel;
  const complexity = classifyTaskComplexity(value);

  if (value.fallbackModel) {
    return decision(
      value.fallbackModel,
      "fallback",
      "provider_fallback",
      "high",
    );
  }
  if (value.lockedModel) {
    return decision(value.lockedModel, "locked", "user_locked", "high");
  }
  if (value.repairTurn) {
    return decision(qualityModel, "quality", "verification_repair", "high");
  }

  const complex = complexity === "complex";
  const simple = complexity === "simple";

  if (value.activeModel) {
    if (
      value.activeModel === value.fastModel &&
      (complex || value.affectedFileCount >= 2)
    ) {
      return decision(
        qualityModel,
        "quality",
        value.affectedFileCount >= 2 ? "write_escalation" : "complex_request",
        "high",
      );
    }
    return decision(
      value.activeModel,
      laneForModel(value.activeModel, value),
      "continue_active_lane",
      "high",
    );
  }
  if (complex) {
    return decision(qualityModel, "quality", "complex_request", "high");
  }
  if (simple && value.fastModel) {
    return decision(value.fastModel, "fast", "simple_request", "medium");
  }
  if (!value.hasWrittenFiles && value.fastModel) {
    return decision(value.fastModel, "fast", "default_lane", "medium");
  }
  return decision(value.defaultModel, "balanced", "default_lane", "medium");
}

function laneForModel(
  model: string,
  input: z.output<typeof RoutingInputSchema>,
): ModelRoutingDecision["lane"] {
  if (model === input.fastModel) return "fast";
  if (model === input.qualityModel) return "quality";
  return "balanced";
}

function decision(
  model: string,
  lane: ModelRoutingDecision["lane"],
  reason: ModelRoutingDecision["reason"],
  confidence: ModelRoutingDecision["confidence"],
): ModelRoutingDecision {
  return { model, lane, reason, confidence };
}
