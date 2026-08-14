import { redactSecrets } from "@orbit-build/shared";
import { isFullAccessEnabled } from "@orbit-build/config";
import {
  discoverSkills,
  validateSkillCatalogBundles,
} from "@orbit-build/context-engine";
import { relative } from "path";
import { buildCacheDiagnostics } from "../CacheDiagnostics.js";
import {
  formatModelOptionLabel,
  getProviderModelCandidates,
  isOfficialDeepSeekProvider,
} from "../ModelCatalog.js";
import type {
  ActiveWebTurn,
  WebUiApprovalSnapshot,
  WebUiLoopSnapshot,
  WebUiMissionControlSnapshot,
  WebUiOptions,
} from "./WebUiContracts.js";
import { sanitizeBaseUrl, summarizeWebToolValue } from "./WebUiSecurity.js";
import { summarizeWebUiAgentRuns } from "./WebUiAgentData.js";
import { loadCustomCommands } from "../../commands/customCommands.js";
import { BUILTIN_SLASH_COMMANDS } from "../SlashCommandCatalog.js";

type WebMessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; name: string; mediaType: string }
  | {
      type: "tool";
      id: string;
      name: string;
      status: "running" | "success" | "error";
      detail?: string;
      summary?: string;
      isError?: boolean;
    };

/** Filter and rank workspace-relative file paths for the Web UI picker. */
export function filterWebUiCompletionFiles(
  files: string[],
  rawQuery: string,
  limit = 60,
): string[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const normalized = Array.from(
    new Set(
      files
        .map((file) => normalizeSafeWebUiPath(file))
        .filter((file): file is string => Boolean(file)),
    ),
  );

  return normalized
    .filter((file) => {
      const lower = file.toLocaleLowerCase();
      return terms.every((term) => lower.includes(term));
    })
    .sort((left, right) => {
      const leftScore = completionFileScore(left, query);
      const rightScore = completionFileScore(right, query);
      return leftScore - rightScore || left.localeCompare(right);
    })
    .slice(0, Math.max(1, Math.min(100, limit)));
}

/** Normalize active context files into a bounded browser-safe summary. */
export function summarizeWebUiContextFiles(
  value: unknown,
  limit = 24,
): {
  files: Array<{ path: string; readOnly: boolean }>;
  total: number;
  truncated: boolean;
} {
  const files: Array<{ path: string; readOnly: boolean }> = [];
  const seen = new Set<string>();
  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (!isRecord(candidate)) continue;
      const path = normalizeSafeWebUiPath(candidate.path);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      files.push({ path, readOnly: candidate.readOnly === true });
    }
  }
  const safeLimit = Math.max(1, Math.min(100, limit));
  return {
    files: files.slice(0, safeLimit),
    total: files.length,
    truncated: files.length > safeLimit,
  };
}

function normalizeSafeWebUiPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (
    !path ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.startsWith("/") ||
    /^[a-zA-Z]:\//.test(path) ||
    path.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }
  return path;
}

function completionFileScore(file: string, query: string): number {
  const lower = file.toLocaleLowerCase();
  const basename = lower.slice(lower.lastIndexOf("/") + 1);
  const depth = file.split("/").length - 1;
  if (!query) return depth * 100 + file.length;
  if (basename === query) return 0;
  if (basename.startsWith(query)) return 100 + depth * 4 + file.length;
  if (basename.includes(query)) return 200 + depth * 4 + file.length;
  if (lower.startsWith(query)) return 300 + depth * 4 + file.length;
  return 400 + lower.indexOf(query) + depth * 4 + file.length;
}

/** Build the credential-safe status snapshot returned by `/api/status`. */
export function collectWebUiStatus(
  options: WebUiOptions,
  activeTurn: ActiveWebTurn | undefined,
) {
  const { cwd, config, loop } = options;
  const fullAccess = isFullAccessEnabled(config);
  const sessions = safeCall(() => loop?.getSessions?.()) || [];
  const relevantFiles = safeCall(() => loop?.getRelevantFiles?.()) || [];
  const history = safeCall(() => loop?.getHistory?.()) || [];
  const visibleMessages = collectWebUiMessages(loop);
  const sessionId = safeCall(() => loop?.getSessionId?.()) || "";
  const providerId = config.provider.default || "unknown";
  const provider = config.providers[providerId] || {};
  const activeModel = getActiveModel(options);
  const modelOverride = safeCall(() => loop?.getModelOverride?.());
  const contextStatus = safeCall(() => loop?.getContextWindowStatus?.());
  const projectMemory = safeCall(() => loop?.getProjectMemory?.());
  const taskPlan = safeCall(() => loop?.getTaskPlan?.());
  const sessionMetrics = safeCall(() => loop?.getSessionMetrics?.());
  const backgroundTasks = summarizeWebUiBackgroundTasks(
    safeCall(() => loop?.getBackgroundTasks?.()),
  );
  const inputQueue = summarizeWebUiInputQueue(
    safeCall(() => loop?.getQueuedInputs?.()),
  );
  const recoveryReport = safeCall(() => loop?.getRecoveryReport?.());
  const review = summarizeWebUiReview(
    safeCall(() => loop?.getSessionReview?.()),
  );
  const contextFiles = summarizeWebUiContextFiles(relevantFiles);
  const normalizedSessions = normalizeSessions(sessions, sessionId);
  const recentSessions = normalizedSessions.filter(
    (session) => session.active || !session.archived,
  );
  const archivedSessions = normalizedSessions.filter(
    (session) => !session.active && session.archived,
  );
  const projects = (safeCall(() => options.getProjects?.()) || [])
    .filter((project) => project && typeof project.path === "string")
    .slice(0, 20)
    .map((project) => ({
      id: String(project.id || "").slice(0, 64),
      path: redactSecrets(project.path).slice(0, 4096),
      name: redactSecrets(project.name || "Orbit").slice(0, 200),
      lastOpenedAt:
        typeof project.lastOpenedAt === "string"
          ? project.lastOpenedAt.slice(0, 64)
          : "",
      available: project.available === true,
    }));
  const agentRuns = summarizeWebUiAgentRuns(
    safeCall(() => options.getAgentRuns?.()) || [],
  );

  return {
    language: config.language,
    workspace: cwd,
    projects,
    agentRuns,
    agentTeam: {
      preset: config.agent.teamPreset,
      maxReviewAttempts: config.agent.maxReviewAttempts,
      maxReviewConcurrency: config.agent.maxReviewConcurrency,
    },
    backgroundTasks,
    inputQueue,
    provider: {
      id: providerId,
      type: provider.type || "unknown",
      baseUrl: sanitizeBaseUrl(provider.baseUrl),
      options: Object.entries(config.providers).map(([id, candidate]) => ({
        id,
        label: id,
        baseUrl: sanitizeBaseUrl(candidate.baseUrl),
        modelCount: getProviderModelCandidates(config, id).length,
      })),
    },
    models: config.models,
    activeModel,
    modelSelection: modelOverride || "__auto__",
    modelRouting: modelOverride ? "locked" : "auto",
    modelOptions: buildModelOptions(options, activeModel),
    permissions: {
      mode: config.permissions.mode,
      fullAccess,
      writeApproval: config.permissions.requireApprovalForWrite,
      commandApproval: config.permissions.requireApprovalForBash,
      dangerousCommandsBlocked: config.permissions.blockDangerousCommands,
      secretsProtected: config.permissions.protectSecrets,
      workspaceBoundary: !fullAccess,
    },
    tools: {
      webSearch: {
        enabled: config.tools.webSearch.enabled,
        provider: config.tools.webSearch.provider,
        maxResults: config.tools.webSearch.maxResults,
      },
      mcp: { enabled: config.tools.mcp.enabled },
    },
    skills: {
      enabled: config.skills.enabled,
      activation: config.skills.activation,
      maxActive: config.skills.maxActive,
    },
    session: {
      activeId: sessionId,
      goal: safeCall(() => loop?.getGoal?.()) || "",
      count: Array.isArray(sessions) ? sessions.length : 0,
      recent: recentSessions,
      archived: archivedSessions,
      historyMessages: Array.isArray(history) ? visibleMessages.length : 0,
      cost: safeCall(() => loop?.getSessionCost?.()) || 0,
      costKnown: safeCall(() => loop?.isSessionCostKnown?.()) !== false,
      inputTokens: safeCall(() => loop?.getTotalInputTokens?.()) || 0,
      cacheReadTokens: safeCall(() => loop?.getTotalCacheReadTokens?.()) || 0,
      outputTokens: safeCall(() => loop?.getTotalOutputTokens?.()) || 0,
      metrics: sessionMetrics || null,
      recovery: recoveryReport
        ? {
            sessionId: String(recoveryReport.sessionId).slice(0, 200),
            previousState: String(recoveryReport.previousState).slice(0, 40),
            previousPhase: String(recoveryReport.previousPhase).slice(0, 200),
            attempt: Math.max(0, Number(recoveryReport.attempt) || 0),
            recoveryCount: Math.max(
              1,
              Number(recoveryReport.recoveryCount) || 1,
            ),
            repairedToolCalls: Math.max(
              0,
              Number(recoveryReport.repairedToolCalls) || 0,
            ),
            resetPlanItems: Math.max(
              0,
              Number(recoveryReport.resetPlanItems) || 0,
            ),
            recoveredAt: String(recoveryReport.recoveredAt).slice(0, 64),
          }
        : null,
    },
    memory: {
      enabled: projectMemory?.enabled !== false,
      count: projectMemory?.entries?.length || 0,
      entries: (projectMemory?.entries || []).slice(0, 20).map((entry) => ({
        id: entry.id,
        text: redactSecrets(entry.text).slice(0, 2000),
      })),
    },
    plan: {
      count: taskPlan?.items?.length || 0,
      completed:
        taskPlan?.items?.filter((item) => item.status === "completed").length ||
        0,
      active:
        taskPlan?.items?.find((item) => item.status === "in_progress")?.text ||
        "",
      items: (taskPlan?.items || []).slice(0, 100).map((item) => ({
        id: item.id,
        text: item.text.slice(0, 1000),
        status: item.status,
      })),
    },
    review,
    context: {
      relevantFiles: contextFiles.total,
      files: contextFiles.files,
      filesTruncated: contextFiles.truncated,
      maxFiles: config.context.maxFilesToIndex,
      compactThreshold: config.context.compactThreshold,
      model: contextStatus?.model || activeModel,
      maxContextTokens: finiteNumber(contextStatus?.maxContextTokens),
      compactAtTokens: finiteNumber(contextStatus?.compactAtTokens),
      estimatedHistoryTokens: finiteNumber(
        contextStatus?.estimatedHistoryTokens,
      ),
      utilization: finiteNumber(contextStatus?.utilization),
    },
    turn: activeTurn
      ? {
          active: true,
          id: activeTurn.id,
          sessionId: activeTurn.sessionId,
          startedAt: activeTurn.startedAt,
          cancelRequested: activeTurn.cancelRequested,
        }
      : { active: false },
    approval: collectWebUiApproval(
      safeCall(() => options.getPendingApproval?.()),
    ),
    cacheDiagnostics: redactSecrets(stripAnsi(buildCacheDiagnostics(cwd))),
    updatedAt: new Date().toISOString(),
  } satisfies WebUiMissionControlSnapshot;
}

/** Bound task metadata before it crosses the local browser boundary. */
export function summarizeWebUiBackgroundTasks(value: unknown) {
  const statuses = new Set([
    "running",
    "completed",
    "failed",
    "killed",
    "timed_out",
  ]);
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .slice(0, 64)
    .map((task) => ({
      id: safeLabel(typeof task.id === "string" ? task.id : "", 200),
      status:
        typeof task.status === "string" && statuses.has(task.status)
          ? task.status
          : "failed",
      startedAt: safeLabel(
        typeof task.startedAt === "string" ? task.startedAt : "",
        64,
      ),
      endedAt:
        typeof task.endedAt === "string"
          ? safeLabel(task.endedAt, 64)
          : undefined,
      durationMs: Math.max(0, finiteNumber(task.durationMs)),
      exitCode:
        task.exitCode === null
          ? null
          : Number.isInteger(task.exitCode)
            ? Number(task.exitCode)
            : null,
      outputTruncated: task.outputTruncated === true,
    }))
    .filter((task) => task.id);
}

/** Expose queue intent without sending image bodies or unbounded text. */
export function summarizeWebUiInputQueue(value: unknown) {
  const modes = new Set(["follow_up", "steer"]);
  const sources = new Set(["terminal", "web", "api"]);
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .slice(0, 12)
    .map((item) => ({
      id: safeLabel(typeof item.id === "string" ? item.id : "", 200),
      mode:
        typeof item.mode === "string" && modes.has(item.mode)
          ? item.mode
          : "follow_up",
      source:
        typeof item.source === "string" && sources.has(item.source)
          ? item.source
          : "api",
      text: redactSecrets(stripAnsi(String(item.text || ""))).slice(0, 4_000),
      attachmentCount: Math.max(
        0,
        Math.min(
          4,
          Array.isArray(item.attachments) ? item.attachments.length : 0,
        ),
      ),
      createdAt: safeLabel(
        typeof item.createdAt === "string" ? item.createdAt : "",
        64,
      ),
    }))
    .filter((item) => item.id && item.text);
}

/** Bound and redact persisted diffs before they cross the browser boundary. */
export function summarizeWebUiReview(value: unknown) {
  const record = isRecord(value) ? value : {};
  const rawChanges = Array.isArray(record.fileChanges)
    ? record.fileChanges
    : [];
  const rawToolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
  const rawCheckpoints = Array.isArray(record.checkpoints)
    ? record.checkpoints
    : [];
  const rawVerification = Array.isArray(record.verification)
    ? record.verification
    : [];

  const fileChanges = rawChanges
    .filter(isRecord)
    .slice(-80)
    .reverse()
    .map((change) => ({
      id: safeLabel(typeof change.id === "string" ? change.id : "", 200),
      path: normalizeSafeWebUiPath(change.path) || "unknown",
      diff: redactSecrets(stripAnsi(String(change.diff || ""))).slice(
        0,
        100_000,
      ),
      createdAt: safeLabel(
        typeof change.createdAt === "string" ? change.createdAt : "",
        100,
      ),
    }))
    .filter((change) => change.id && change.path !== "unknown");

  const checkpoints = rawCheckpoints
    .filter(isRecord)
    .slice(-40)
    .reverse()
    .map((checkpoint) => ({
      id: safeLabel(
        typeof checkpoint.id === "string" ? checkpoint.id : "",
        200,
      ),
      timestamp: safeLabel(
        typeof checkpoint.timestamp === "string" ? checkpoint.timestamp : "",
        100,
      ),
      toolCallId: safeLabel(
        typeof checkpoint.toolCallId === "string" ? checkpoint.toolCallId : "",
        200,
      ),
      files: (Array.isArray(checkpoint.files) ? checkpoint.files : [])
        .map((path) => normalizeSafeWebUiPath(path))
        .filter((path): path is string => Boolean(path))
        .slice(0, 50),
    }))
    .filter((checkpoint) => checkpoint.id);

  const verification = rawVerification
    .filter(isRecord)
    .slice(-20)
    .reverse()
    .map((entry) => ({
      timestamp: safeLabel(
        typeof entry.timestamp === "string" ? entry.timestamp : "",
        100,
      ),
      success: typeof entry.success === "boolean" ? entry.success : undefined,
      detail:
        typeof entry.detail === "string"
          ? redactSecrets(stripAnsi(entry.detail)).slice(0, 2_000)
          : undefined,
    }));

  const toolCalls = rawToolCalls
    .filter(isRecord)
    .slice(-100)
    .reverse()
    .map((tool) => {
      const startedAt = safeLabel(
        typeof tool.startedAt === "string" ? tool.startedAt : "",
        100,
      );
      const endedAt = safeLabel(
        typeof tool.endedAt === "string" ? tool.endedAt : "",
        100,
      );
      const startMs = Date.parse(startedAt);
      const endMs = Date.parse(endedAt);
      return {
        id: safeLabel(typeof tool.id === "string" ? tool.id : "", 200),
        name: safeLabel(
          typeof tool.toolName === "string" ? tool.toolName : "tool",
          200,
        ),
        risk: safeLabel(typeof tool.risk === "string" ? tool.risk : "", 40),
        decision: safeLabel(
          typeof tool.permissionDecision === "string"
            ? tool.permissionDecision
            : "",
          80,
        ),
        status: ["pending", "success", "failed", "denied"].includes(
          String(tool.status),
        )
          ? String(tool.status)
          : "failed",
        startedAt,
        endedAt,
        durationMs:
          Number.isFinite(startMs) && Number.isFinite(endMs)
            ? Math.max(0, endMs - startMs)
            : undefined,
      };
    })
    .filter((tool) => tool.id);

  return { fileChanges, toolCalls, checkpoints, verification };
}

/** Normalize a pending confirmation before exposing it to the browser. */
export function collectWebUiApproval(
  value: unknown,
): WebUiApprovalSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.id !== "string" ||
    !["tool", "change", "action"].includes(String(value.kind))
  ) {
    return undefined;
  }
  const title = safeApprovalText(value.title, 200, false);
  const reason = safeApprovalText(value.reason, 1_500, false);
  if (!title || !reason) return undefined;
  return {
    id: safeApprovalText(value.id, 200, false),
    kind: value.kind as WebUiApprovalSnapshot["kind"],
    title,
    reason,
    preview: value.preview
      ? safeApprovalText(value.preview, 24_000, true)
      : undefined,
    toolCallId: value.toolCallId
      ? safeApprovalText(value.toolCallId, 200, false)
      : undefined,
    agentId:
      typeof value.agentId === "string" &&
      /^agent_[a-z0-9-]+$/.test(value.agentId)
        ? value.agentId.slice(0, 128)
        : undefined,
    agentRole: value.agentRole
      ? safeApprovalText(value.agentRole, 80, false)
      : undefined,
    requestedAt:
      typeof value.requestedAt === "string"
        ? safeApprovalText(value.requestedAt, 100, false)
        : "",
  };
}

function safeApprovalText(
  value: unknown,
  maxLength: number,
  preserveLines: boolean,
): string {
  if (typeof value !== "string") return "";
  const safe = redactSecrets(stripAnsi(value)).replace(
    preserveLines
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
      : /[\u0000-\u001f\u007f]/g,
    " ",
  );
  return (preserveLines ? safe : safe.replace(/\s+/g, " "))
    .trim()
    .slice(0, maxLength);
}

function normalizeSessions(sessions: unknown, activeId: string) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter(isRecord)
    .map((session) => ({
      id: typeof session.id === "string" ? session.id : "",
      title:
        typeof session.title === "string" && session.title.trim()
          ? redactSecrets(session.title.trim()).slice(0, 160)
          : "Untitled task",
      model: typeof session.model === "string" ? session.model : "",
      updatedAt:
        typeof session.updatedAt === "string"
          ? session.updatedAt
          : typeof session.createdAt === "string"
            ? session.createdAt
            : "",
      active: session.id === activeId,
      archived: typeof session.archivedAt === "string",
      archivedAt:
        typeof session.archivedAt === "string" ? session.archivedAt : "",
    }))
    .filter((session) => session.id)
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
}

/** Normalize AgentLoop history into the narrow browser message contract. */
export function collectWebUiMessages(loop?: WebUiLoopSnapshot) {
  const history = safeCall(() => loop?.getHistory?.()) || [];
  if (!Array.isArray(history)) return [];
  const normalized = history
    .filter((message) => !isInternalWebMessage(message))
    .map((message, index) => normalizeMessage(message, index));
  return mergeAssistantTurns(mergeToolResultMessages(normalized));
}

export interface WebUiMessagePage {
  messages: Array<ReturnType<typeof normalizeMessage> & { position: number }>;
  page: {
    sessionId: string;
    total: number;
    start: number;
    end: number;
    hasEarlier: boolean;
    nextBefore?: number;
  };
}

/** Return one bounded page of browser-safe messages, newest page by default. */
export function collectWebUiMessagePage(
  loop?: WebUiLoopSnapshot,
  options: { before?: number; limit?: number } = {},
): WebUiMessagePage {
  const messages = collectWebUiMessages(loop);
  const total = messages.length;
  const limit = Math.max(20, Math.min(100, options.limit ?? 60));
  const requestedEnd =
    typeof options.before === "number" ? options.before : total;
  const end = Math.max(0, Math.min(total, requestedEnd));
  const start = Math.max(0, end - limit);
  return {
    messages: messages.slice(start, end).map((message, index) => ({
      ...message,
      position: start + index,
    })),
    page: {
      sessionId: safeCall(() => loop?.getSessionId?.()) || "",
      total,
      start,
      end,
      hasEarlier: start > 0,
      ...(start > 0 ? { nextBefore: start } : {}),
    },
  };
}

/** Build the editable settings snapshot returned by `/api/settings`. */
export function collectWebUiSettings(options: WebUiOptions) {
  const { config } = options;
  const activeModel = getActiveModel(options);
  return {
    language: config.language,
    model: activeModel,
    modelOptions: buildModelOptions(options, activeModel),
    permissionMode: config.permissions.mode,
    webSearchEnabled: config.tools.webSearch.enabled,
    webSearchProvider: config.tools.webSearch.provider,
    webSearchMaxResults: config.tools.webSearch.maxResults,
    skillsEnabled: config.skills.enabled,
    skillsActivation: config.skills.activation,
    skillsMaxActive: config.skills.maxActive,
    skillsDisabled: config.skills.disabled,
  };
}

/** Build a bounded, credential-safe skill inventory for the settings panel. */
export async function collectWebUiSkills(options: WebUiOptions) {
  const catalog = await discoverSkills(options.cwd, options.config.skills);
  catalog.diagnostics.push(
    ...(await validateSkillCatalogBundles(catalog.skills)),
  );
  const workflows = loadCustomCommands(
    options.cwd,
    BUILTIN_SLASH_COMMANDS,
  ).filter((command) => command.source === "project");
  const displayPath = (path: string) => {
    const projectRelative = relative(options.cwd, path).replace(/\\/g, "/");
    if (projectRelative && !projectRelative.startsWith("..")) {
      return projectRelative;
    }
    const file = path.replace(/\\/g, "/");
    return `…/${file.split("/").slice(-3).join("/")}`;
  };
  return {
    enabled: options.config.skills.enabled,
    activation: options.config.skills.activation,
    maxActive: options.config.skills.maxActive,
    skills: catalog.skills.slice(0, 200).map((skill) => ({
      name: skill.name,
      displayName: redactSecrets(skill.displayName || skill.name).slice(0, 100),
      description: redactSecrets(skill.description).slice(0, 500),
      shortDescription: redactSecrets(
        skill.shortDescription || skill.description,
      ).slice(0, 200),
      defaultPrompt: redactSecrets(
        skill.defaultPrompt || `$${skill.name} `,
      ).slice(0, 2_000),
      allowImplicitInvocation: skill.allowImplicitInvocation,
      path: displayPath(skill.path),
      disabled: skill.disabled,
      truncated: skill.truncated,
      loadedBytes: skill.loadedBytes,
    })),
    diagnostics: catalog.diagnostics.slice(0, 50).map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: redactSecrets(diagnostic.message).slice(0, 1_000),
      path: displayPath(diagnostic.path),
    })),
    workflows: workflows.slice(0, 100).map((workflow) => ({
      name: workflow.name,
      description: redactSecrets(workflow.description).slice(0, 240),
      argumentHint: redactSecrets(workflow.argumentHint || "").slice(0, 120),
      path: displayPath(workflow.filePath),
    })),
  };
}

function getActiveModel(options: WebUiOptions): string {
  return (
    safeCall(() => options.loop?.getModelOverride?.()) ||
    options.config.models.default
  );
}

function buildModelOptions(options: WebUiOptions, activeModel: string) {
  const { config } = options;
  const providerId = config.provider.default;
  const providerModels = getProviderModelCandidates(config, providerId);
  const includeActiveModel =
    !isOfficialDeepSeekProvider(config, providerId) ||
    providerModels.includes(activeModel);
  const discovered = Array.from(
    new Set([...(includeActiveModel ? [activeModel] : []), ...providerModels]),
  )
    .map((model) => model?.trim())
    .filter((model): model is string => Boolean(model))
    .map((model) => ({ id: model, label: formatModelOptionLabel(model) }));
  const automatic = {
    id: "__auto__",
    label: isOfficialDeepSeekProvider(config, providerId)
      ? "Auto · deepseek-v4-flash / deepseek-v4-pro"
      : "Auto",
  };
  return safeCall(() => options.loop?.getModelOverride?.())
    ? [discovered[0], automatic, ...discovered.slice(1)]
    : [automatic, ...discovered];
}

function normalizeMessage(message: unknown, index: number) {
  const record = isRecord(message) ? message : {};
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  const role =
    record.role === "user" ||
    record.role === "assistant" ||
    record.role === "tool"
      ? record.role
      : "assistant";
  const blocks = normalizeMessageBlocks(record.content);
  return {
    id: typeof record.id === "string" ? record.id : `message-${index}`,
    role,
    createdAt:
      typeof record.createdAt === "string" ? record.createdAt : undefined,
    model:
      role === "assistant" && typeof metadata.model === "string"
        ? safeLabel(metadata.model, 96)
        : undefined,
    text: blocks
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("\n"),
    blocks,
  };
}

function normalizeMessageBlocks(content: unknown): WebMessageBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const blocks: WebMessageBlock[] = [];
  for (const candidate of content) {
    if (!isRecord(candidate)) continue;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      blocks.push({ type: "text", text: candidate.text });
      continue;
    }
    if (candidate.type === "thinking" && typeof candidate.text === "string") {
      blocks.push({ type: "thinking", text: candidate.text });
      continue;
    }
    if (candidate.type === "image" && typeof candidate.mediaType === "string") {
      blocks.push({
        type: "image",
        name:
          typeof candidate.name === "string"
            ? safeLabel(candidate.name, 255)
            : "image",
        mediaType: safeLabel(candidate.mediaType, 100),
      });
      continue;
    }
    if (candidate.type === "tool_call" && isRecord(candidate.toolCall)) {
      blocks.push({
        type: "tool",
        id:
          typeof candidate.toolCall.id === "string"
            ? candidate.toolCall.id
            : "",
        name:
          typeof candidate.toolCall.name === "string"
            ? candidate.toolCall.name
            : "tool",
        status: "running",
        ...toolDetail(candidate.toolCall.arguments),
      });
      continue;
    }
    if (candidate.type === "tool_result" && isRecord(candidate.toolResult)) {
      const isError = candidate.toolResult.isError === true;
      blocks.push({
        type: "tool",
        id:
          typeof candidate.toolResult.toolCallId === "string"
            ? candidate.toolResult.toolCallId
            : "",
        name:
          typeof candidate.toolResult.name === "string"
            ? candidate.toolResult.name
            : "tool",
        status: isError ? "error" : "success",
        ...(isError
          ? toolDetail(candidate.toolResult.content, { allowPlainText: true })
          : {}),
        ...(!isError
          ? successfulToolSummary(
              typeof candidate.toolResult.name === "string"
                ? candidate.toolResult.name
                : "",
              candidate.toolResult.content,
            )
          : {}),
        ...(isError ? { isError: true } : {}),
      });
    }
  }
  return blocks;
}

function mergeToolResultMessages(
  messages: ReturnType<typeof normalizeMessage>[],
) {
  const pending = new Map<string, Extract<WebMessageBlock, { type: "tool" }>>();
  const merged: ReturnType<typeof normalizeMessage>[] = [];
  for (const message of messages) {
    const remaining: WebMessageBlock[] = [];
    for (const block of message.blocks) {
      if (block.type !== "tool" || !block.id) {
        remaining.push(block);
        continue;
      }
      if (block.status === "running") {
        pending.set(block.id, block);
        remaining.push(block);
        continue;
      }
      const proposal = pending.get(block.id);
      if (!proposal) {
        remaining.push(block);
        continue;
      }
      proposal.status = block.status;
      if (block.isError) proposal.isError = true;
      else delete proposal.isError;
      if (block.detail) proposal.detail = block.detail;
      if (block.summary) proposal.summary = block.summary;
      pending.delete(block.id);
    }
    if (message.role !== "tool" || message.text || remaining.length) {
      merged.push({ ...message, blocks: remaining });
    }
  }
  return merged;
}

function mergeAssistantTurns(messages: ReturnType<typeof normalizeMessage>[]) {
  const merged: ReturnType<typeof normalizeMessage>[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (message.role !== "user" && previous && previous.role !== "user") {
      if (!previous.model && message.model) previous.model = message.model;
      previous.blocks.push(...message.blocks);
      previous.text = [previous.text, message.text]
        .filter(Boolean)
        .join("\n\n");
      continue;
    }
    merged.push({ ...message, blocks: [...message.blocks] });
  }
  return merged;
}

function safeLabel(value: string, maxLength: number): string {
  return redactSecrets(stripAnsi(value))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function toolDetail(
  value: unknown,
  options: { allowPlainText?: boolean } = {},
): { detail: string } | Record<string, never> {
  const detail = summarizeWebToolValue(value, options);
  return detail ? { detail } : {};
}

function successfulToolSummary(
  toolName: string,
  value: unknown,
): { summary: string } | Record<string, never> {
  if (typeof value !== "string") return {};
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (toolName === "web_search") {
    const firstLine = normalized
      .split("\n", 1)[0]
      .replace(/^web_search result:\s*/i, "");
    const summary = safeLabel(firstLine, 320);
    return summary ? { summary } : {};
  }
  if (toolName === "web_fetch") {
    const source = /^Source:\s*(https?:\/\/\S+)/im.exec(normalized)?.[1];
    if (!source) return {};
    try {
      return { summary: `Fetched ${new URL(source).hostname}` };
    } catch {
      return {};
    }
  }
  return {};
}

function isInternalWebMessage(message: unknown): boolean {
  if (!isRecord(message)) return true;
  if (message.role === "system") return true;
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  return (
    metadata.kind === "orbit_volatile_context" ||
    metadata.kind === "history_compaction_summary"
  );
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
