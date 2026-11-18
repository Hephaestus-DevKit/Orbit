import { z } from "zod";
import type { ToolResult } from "@orbit-build/tools";
import { DEEPSEEK_WEB_REQUEST_COST_USD } from "@orbit-build/tools";

const UsageSchema = z
  .object({
    provider: z.literal("deepseek"),
    operation: z.enum(["search", "fetch"]),
    successfulRequests: z.number().int().min(0).max(1),
    estimatedCostUsd: z
      .number()
      .finite()
      .min(0)
      .max(DEEPSEEK_WEB_REQUEST_COST_USD),
    pricingAsOf: z.literal("2026-11-16"),
  })
  .refine(
    (usage) =>
      usage.estimatedCostUsd
      === usage.successfulRequests * DEEPSEEK_WEB_REQUEST_COST_USD,
  );

/** Project only validated built-in web usage into session billing and audit events. */
export function resolveExternalToolUsage(toolName: string, result: ToolResult) {
  if (toolName !== "web_search" && toolName !== "web_fetch") return undefined;
  if (result.metadata?.externalUsageUnknown === true)
    return { known: false as const };
  const parsed = UsageSchema.safeParse(result.metadata?.externalUsage);
  if (!parsed.success || `web_${parsed.data.operation}` !== toolName)
    return undefined;
  return { known: true as const, ...parsed.data };
}
