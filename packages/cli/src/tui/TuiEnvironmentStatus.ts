export interface TuiCacheTelemetry {
  slabHash: string;
  slabTokenEstimate: number;
  hitTokens: number;
  missTokens: number;
  inputTokens: number;
  hitRate: number;
  degraded: boolean;
}

export interface TuiEnvironmentSnapshot {
  permissionsMode: string;
  activeModelName: string;
  currentAttempt: number;
  sessionCost: number;
  costKnown: boolean;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalOutputTokens: number;
  cacheTelemetry: TuiCacheTelemetry | null;
}

/** Owns mutable runtime metadata independently from conversation rendering. */
export class TuiEnvironmentStatus {
  private snapshotValue: TuiEnvironmentSnapshot = {
    permissionsMode: "normal",
    activeModelName: "",
    currentAttempt: 0,
    sessionCost: 0,
    costKnown: true,
    totalInputTokens: 0,
    totalCacheReadTokens: 0,
    totalOutputTokens: 0,
    cacheTelemetry: null,
  };

  public snapshot(): Readonly<TuiEnvironmentSnapshot> {
    return this.snapshotValue;
  }

  public setPermissionsMode(mode: string): void {
    this.snapshotValue = { ...this.snapshotValue, permissionsMode: mode };
  }

  public setActiveModelName(model: string): void {
    this.snapshotValue = { ...this.snapshotValue, activeModelName: model };
  }

  public setAttempt(attempt: number): void {
    this.snapshotValue = { ...this.snapshotValue, currentAttempt: attempt };
  }

  public setUsage(
    sessionCost: number,
    totalInputTokens: number,
    totalCacheReadTokens: number,
    totalOutputTokens: number,
    costKnown = true,
  ): void {
    this.snapshotValue = {
      ...this.snapshotValue,
      sessionCost,
      costKnown,
      totalInputTokens,
      totalCacheReadTokens,
      totalOutputTokens,
    };
  }

  public setCacheTelemetry(cacheTelemetry: TuiCacheTelemetry): void {
    this.snapshotValue = { ...this.snapshotValue, cacheTelemetry };
  }
}
