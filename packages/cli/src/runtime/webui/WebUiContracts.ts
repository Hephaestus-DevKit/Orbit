import type { OrbitConfig } from "@orbit-build/config";

export interface WebUiImageAttachment {
  id: string;
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  data: string;
  size: number;
}

/** Read-only AgentLoop surface exposed to the local Web UI. */
export interface WebUiLoopSnapshot {
  getSessionId?: () => string;
  getGoal?: () => string | undefined;
  getProjectMemory?: () => {
    enabled: boolean;
    entries: Array<{ id: string; text: string }>;
  };
  getTaskPlan?: () =>
    | {
        items: Array<{
          id: string;
          text: string;
          status: "pending" | "in_progress" | "completed";
        }>;
      }
    | undefined;
  getSessionMetrics?: () =>
    | {
        eventCount: number;
        toolRuns: number;
        toolFailures: number;
        deniedTools: number;
        filesChanged: number;
        modelSwitches: number;
        routingDecisions: number;
        fastRoutes: number;
        qualityRoutes: number;
        compactions: number;
        resumedCount: number;
      }
    | undefined;
  getRecoveryReport?: () =>
    | {
        sessionId: string;
        previousState: string;
        previousPhase: string;
        attempt: number;
        recoveryCount: number;
        repairedToolCalls: number;
        resetPlanItems: number;
        recoveredAt: string;
      }
    | undefined;
  getSessions?: () => unknown[];
  getRelevantFiles?: () => Array<{
    path: string;
    reason?: string;
    readOnly?: boolean;
  }>;
  getHistory?: () => unknown[];
  getSessionCost?: () => number;
  getTotalInputTokens?: () => number;
  getTotalCacheReadTokens?: () => number;
  getTotalOutputTokens?: () => number;
  getModelOverride?: () => string | undefined;
  clearModelOverride?: () => void;
  getContextWindowStatus?: () => {
    model: string;
    maxContextTokens: number;
    compactAtTokens: number;
    estimatedHistoryTokens: number;
    utilization: number;
  };
  getSessionReview?: () => {
    fileChanges: Array<{
      id: string;
      path: string;
      diff: string;
      createdAt: string;
    }>;
    toolCalls?: Array<{
      id: string;
      toolName: string;
      risk: string;
      permissionDecision: string;
      status: "pending" | "success" | "failed" | "denied";
      startedAt: string;
      endedAt?: string;
    }>;
    checkpoints: Array<{
      id: string;
      timestamp: string;
      toolCallId: string;
      files: string[];
    }>;
    verification: Array<{
      timestamp: string;
      success?: boolean;
      detail?: string;
    }>;
  };
}

/** Settings that may be changed from the local Web UI. */
export interface WebUiSettingsPatch {
  provider?: string;
  model?: string;
  permissionMode?: "strict" | "normal" | "auto" | "plan";
  webSearchEnabled?: boolean;
  webSearchProvider?: "auto" | "searxng" | "tavily" | "bing" | "duckduckgo";
  webSearchMaxResults?: number;
}

/** A session navigation request made by the local Web UI. */
export type WebUiSessionAction =
  | { action: "new" }
  | {
      action: "resume" | "archive" | "restore" | "delete";
      sessionId: string;
    };

/** Open/create a project, or remove its registry entry without deleting files. */
export type WebUiProjectAction =
  | { action: "pick" }
  | { action: "open" | "create"; path: string }
  | { action: "remove"; projectId: string };

/** A reversible review action initiated from the browser changes surface. */
export type WebUiReviewAction =
  | { action: "rollback-file"; path: string }
  | { action: "rewind"; checkpointId: string };

/** Result of a project action, including a path selected by the OS picker. */
export interface WebUiProjectActionResult {
  ok: boolean;
  message?: string;
  path?: string;
  cancelled?: boolean;
}

/** A bounded approval request that may be rendered by the local Web UI. */
export interface WebUiApprovalSnapshot {
  id: string;
  kind: "tool" | "change" | "action";
  title: string;
  reason: string;
  preview?: string;
  toolCallId?: string;
  requestedAt: string;
}

/** A browser decision for one currently pending approval request. */
export interface WebUiApprovalDecision {
  id: string;
  approved: boolean;
}

/** Dependencies and callbacks needed to host the local Web UI. */
export interface WebUiOptions {
  cwd: string;
  config: OrbitConfig;
  loop?: WebUiLoopSnapshot;
  port?: number;
  /** @deprecated Orbit no longer opens a browser automatically. */
  open?: boolean;
  getProjects?: () => Array<{
    id: string;
    path: string;
    name: string;
    lastOpenedAt: string;
    available: boolean;
  }>;
  submitPrompt?: (
    prompt: string,
    attachments?: WebUiImageAttachment[],
  ) => Promise<{ ok: boolean; message?: string }>;
  cancelPrompt?: () =>
    | { ok: boolean; message?: string }
    | Promise<{ ok: boolean; message?: string }>;
  updateSettings?: (
    patch: WebUiSettingsPatch,
  ) => Promise<{ ok: boolean; message?: string }>;
  updateSession?: (
    action: WebUiSessionAction,
  ) => Promise<{ ok: boolean; message?: string }>;
  openProject?: (
    action: WebUiProjectAction,
  ) => Promise<WebUiProjectActionResult>;
  updateReview?: (
    action: WebUiReviewAction,
  ) => Promise<{ ok: boolean; message?: string }>;
  exportTrace?: (includeHistory: boolean) => unknown;
  getPendingApproval?: () => WebUiApprovalSnapshot | undefined;
  respondToApproval?: (
    decision: WebUiApprovalDecision,
  ) =>
    | { ok: boolean; message?: string }
    | Promise<{ ok: boolean; message?: string }>;
}

/** Handle returned for a running Web UI server. */
export interface WebUiHandle {
  url: string;
  port: number;
  /** @deprecated Orbit no longer opens a browser automatically. */
  browserOpened?: false;
  close(): Promise<void>;
}

/** A prompt currently executing through the Web UI bridge. */
export interface ActiveWebTurn {
  id: string;
  sessionId: string;
  startedAt: string;
  cancelRequested: boolean;
}
