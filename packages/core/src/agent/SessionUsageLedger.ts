import type { TokenUsage } from "@orbit-build/model-providers";
import type { OrbitConfig } from "@orbit-build/config";

export interface UsageSnapshot {
  totalCostEstimate?: number;
  costEstimateKnown?: boolean;
  pendingCostEstimate?: number;
  totalInputTokens?: number;
  totalCacheReadTokens?: number;
  totalOutputTokens?: number;
}

/** One shared admission pool for independently persisted child sessions. */
export interface SharedUsageBudget {
  ledger: SessionUsageLedger;
  limit: number;
  persist: () => void;
}

/** Own known charges independently of whether the complete bill can be estimated. */
export class SessionUsageLedger {
  public costUsd = 0;
  public costKnown = true;
  public pendingCostUsd = 0;
  public inputTokens = 0;
  public cacheReadTokens = 0;
  public outputTokens = 0;

  public constructor(
    private readonly parent?: Pick<SharedUsageBudget, "ledger" | "limit">,
  ) {}

  /** Restore a durable lower bound, including sessions with incomplete pricing. */
  public restore(snapshot: UsageSnapshot = {}): void {
    if (
      this.parent
      && [
        snapshot.totalCostEstimate,
        snapshot.pendingCostEstimate,
        snapshot.totalInputTokens,
        snapshot.totalOutputTokens,
      ].some((value) => (value ?? 0) > 0)
    )
      throw new Error(
        "Shared-budget children must start a new session; restore the owning run budget before scheduling new children.",
      );
    this.costUsd = snapshot.totalCostEstimate ?? 0;
    this.costKnown = snapshot.costEstimateKnown !== false;
    this.pendingCostUsd = snapshot.pendingCostEstimate ?? 0;
    if (this.pendingCostUsd > 0) this.costKnown = false;
    this.inputTokens = snapshot.totalInputTokens ?? 0;
    this.cacheReadTokens = snapshot.totalCacheReadTokens ?? 0;
    this.outputTokens = snapshot.totalOutputTokens ?? 0;
  }

  /** Always retain known charges; unknown usage must never disable the budget. */
  public recordCharge(cost: number, known: boolean): number {
    if (!Number.isFinite(cost) || cost < 0)
      throw new Error("Usage cost must be finite and nonnegative.");
    this.costUsd += cost;
    this.costKnown &&= known;
    this.parent?.ledger.recordCharge(cost, known);
    return cost;
  }

  /** Record provider token usage using the rate selected for this request. */
  public recordModel(
    usage: TokenUsage,
    pricing: OrbitConfig["pricing"][string] | undefined,
  ): number {
    const input = validTokens(usage.inputTokens);
    const output = validTokens(usage.outputTokens);
    const cached = Math.min(input, validTokens(usage.cacheReadTokens));
    this.inputTokens += input;
    this.outputTokens += output;
    this.cacheReadTokens += cached;
    if (this.parent) {
      this.parent.ledger.inputTokens += input;
      this.parent.ledger.outputTokens += output;
      this.parent.ledger.cacheReadTokens += cached;
    }
    const cost = pricing
      ? ((input - cached) * pricing.inputCostPer1M
        + output * pricing.outputCostPer1M
        + cached * (pricing.cacheReadCostPer1M ?? pricing.inputCostPer1M))
        / 1_000_000
      : 0;
    return this.recordCharge(cost, pricing !== undefined);
  }

  /** A partial estimate is still a lower bound that can reach the limit. */
  public reachesBudget(limit: number): boolean {
    return this.remainingBudget(limit) <= 0;
  }

  /** Reserve before dispatch; concurrent requests share the same remaining budget. */
  public reserve(cost: number, limit: number): void {
    if (
      !Number.isFinite(cost)
      || cost < 0
      || !Number.isFinite(limit)
      || limit < 0
    )
      throw new Error("Budget reservations must be finite and nonnegative.");
    if (cost > this.remainingBudget(limit))
      throw new Error("Insufficient request budget.");
    this.parent?.ledger.reserve(cost, this.parent.limit);
    this.pendingCostUsd += cost;
  }

  /** Release a settled or definitely rejected request; ambiguous requests retain their hold. */
  public release(cost: number): void {
    if (
      !Number.isFinite(cost)
      || cost < 0
      || cost > this.pendingCostUsd + 1e-10
    )
      throw new Error("Invalid budget settlement.");
    this.parent?.ledger.release(cost);
    this.pendingCostUsd = Math.max(0, this.pendingCostUsd - cost);
  }

  public remainingBudget(limit: number): number {
    return Math.max(
      0,
      Math.min(
        limit - this.costUsd - this.pendingCostUsd,
        this.parent?.ledger.remainingBudget(this.parent.limit) ?? Infinity,
      ),
    );
  }

  /** Preserve the known subtotal even while the complete estimate is unknown. */
  public snapshot(): Required<UsageSnapshot> {
    return {
      totalCostEstimate: this.costUsd,
      costEstimateKnown: this.costKnown,
      pendingCostEstimate: this.pendingCostUsd,
      totalInputTokens: this.inputTokens,
      totalCacheReadTokens: this.cacheReadTokens,
      totalOutputTokens: this.outputTokens,
    };
  }
}

function validTokens(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}
