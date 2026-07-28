import type { IncomingMessage } from "http";
import { timingSafeEqual } from "crypto";
import { redactSecrets } from "@orbit-build/shared";
import { z } from "zod";

/** Allowlist and redact an internal event before exposing it to a browser. */
export function sanitizeWebEventPayload(
  type: string,
  payload: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  switch (type) {
    case "ui_turn_started":
      return {
        turnId: safeWebText(payload.turnId, 200),
        source: payload.source === "terminal" ? "terminal" : "web",
        prompt: safeWebText(payload.prompt, 8_000),
      };
    case "ui_turn_completed":
      return {
        turnId: safeWebText(payload.turnId, 200),
        source: payload.source === "terminal" ? "terminal" : "web",
        status:
          payload.status === "failed" || payload.status === "aborted"
            ? payload.status
            : "completed",
        message: safeWebText(payload.message, 2_000),
      };
    case "model_request":
      return { model: safeWebText(payload.model, 200) };
    case "model_routing":
      return {
        model: safeWebText(payload.model, 200),
        lane: ["locked", "fallback", "fast", "balanced", "quality"].includes(
          String(payload.lane),
        )
          ? String(payload.lane)
          : "balanced",
        reason: safeWebText(payload.reason, 100),
        confidence: payload.confidence === "high" ? "high" : "medium",
      };
    case "model_response":
      return {
        model: safeWebText(payload.model, 200),
        usage: sanitizeTokenUsage(payload.usage),
      };
    case "model_delta":
    case "thinking_delta":
      return { text: safeWebText(payload.text, 65_536) };
    case "tool_proposal":
      return {
        toolCallId: safeWebText(payload.toolCallId, 200),
        toolName: safeWebText(payload.toolName, 200),
        ...(summarizeWebToolValue(payload.arguments)
          ? { detail: summarizeWebToolValue(payload.arguments) }
          : {}),
        explanation: safeWebText(payload.explanation, 500),
      };
    case "tool_result":
      return {
        toolCallId: safeWebText(payload.toolCallId, 200),
        toolName: safeWebText(payload.toolName, 200),
        display: safeWebText(payload.display, 500),
        error: safeWebText(payload.error, 1_000),
      };
    case "tool_approval":
      return {
        toolCallId: safeWebText(payload.toolCallId, 200),
        approved: payload.approved === true,
        reason: safeWebText(payload.reason, 500),
      };
    case "web_approval_requested":
      return {
        approvalId: safeWebText(payload.approvalId, 200),
        kind:
          payload.kind === "change" || payload.kind === "action"
            ? payload.kind
            : "tool",
        title: safeWebText(payload.title, 200),
        toolCallId: safeWebText(payload.toolCallId, 200),
      };
    case "web_approval_resolved":
      return {
        approvalId: safeWebText(payload.approvalId, 200),
        approved: payload.approved === true,
      };
    case "cost_update":
      return {
        turnCost: safeNumber(payload.turnCost),
        sessionCost: safeNumber(payload.sessionCost),
        totalInputTokens: safeNumber(payload.totalInputTokens),
        totalCacheReadTokens: safeNumber(payload.totalCacheReadTokens),
        totalOutputTokens: safeNumber(payload.totalOutputTokens),
      };
    case "cache_update":
      return {
        hitTokens: safeNumber(payload.hitTokens),
        missTokens: safeNumber(payload.missTokens),
        inputTokens: safeNumber(payload.inputTokens),
        hitRate: safeNumber(payload.hitRate),
        degraded: payload.degraded === true,
      };
    case "agent_start": {
      const taskId = safeWebText(payload.taskId, 200);
      if (!taskId) return undefined;
      return {
        taskId,
        task: safeWebText(payload.task, 1_000),
      };
    }
    case "agent_spawn": {
      const childId = safeWebText(payload.childId, 200);
      if (!childId) return undefined;
      return {
        parentId: safeWebText(payload.parentId, 200),
        childId,
        role: safeWebText(payload.role, 100),
        task: safeWebText(payload.task, 1_000),
      };
    }
    case "agent_status": {
      const taskId = safeWebText(payload.taskId, 200);
      if (!taskId) return undefined;
      return {
        taskId,
        status: safeWebText(payload.status, 100),
        detail: safeWebText(payload.detail, 500),
      };
    }
    case "agent_completed": {
      const taskId = safeWebText(payload.taskId, 200);
      if (!taskId) return undefined;
      return {
        taskId,
        success: payload.success === true,
        error: safeWebText(payload.error, 1_000),
      };
    }
    case "loop_start":
      return { attempt: safeNumber(payload.attempt) };
    case "verification_started":
      return { type: safeWebText(payload.type, 100) };
    case "verification_ended":
      return { success: payload.success === true };
    case "checkpoint_created":
      return {
        timestamp: safeWebText(payload.timestamp, 100),
        message: safeWebText(payload.message, 500),
      };
    case "file_change":
      return {
        filePath: safeWebText(payload.filePath, 500),
        type: safeWebText(payload.type, 20),
        explanation: safeWebText(payload.explanation, 500),
      };
    case "file_diff":
      return {
        filePath: safeWebText(payload.filePath, 500),
        diff: safeWebText(payload.diff, 48_000),
      };
    case "skill_activated":
      return {
        name: safeWebText(payload.name, 100),
        activation: payload.activation === "explicit" ? "explicit" : "auto",
        loadedBytes: safeNumber(payload.loadedBytes),
        truncated: payload.truncated === true,
      };
    case "info":
    case "warning":
    case "error":
      return { message: safeWebText(payload.message, 2_000) };
    default:
      return undefined;
  }
}

/** Validate either a bearer token or the protected local session cookie. */
export function isAuthorizedWebRequest(
  req: IncomingMessage,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken || !isRequestOriginAllowed(req)) return false;
  const authorization = req.headers.authorization;
  const cookieToken = readCookie(req, "orbit_web_token");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : cookieToken;
  return safeTokenMatch(supplied, expectedToken);
}

/** Validate the one-time bearer token used to establish the browser cookie. */
export function isBearerAuthorizedWebRequest(
  req: IncomingMessage,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken || !isRequestOriginAllowed(req)) return false;
  const authorization = req.headers.authorization;
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  return safeTokenMatch(supplied, expectedToken);
}

/**
 * Authorize the local SSE endpoint when a browser has declined the HttpOnly
 * loopback cookie. The capability is accepted only for this stream URL and
 * remains protected by the same-origin check.
 */
export function isAuthorizedWebEventRequest(
  req: IncomingMessage,
  expectedToken: string | undefined,
  url: URL,
): boolean {
  if (!expectedToken || !isRequestOriginAllowed(req)) return false;
  return safeTokenMatch(
    url.searchParams.get("access_token") || "",
    expectedToken,
  );
}

/** Convert an unknown failure into a bounded, credential-safe browser message. */
export function safeWebMessage(error: unknown): string {
  return safeWebText(
    error instanceof Error ? error.message : String(error),
    2_000,
  );
}

/** Extract only low-risk, display-oriented fields from tool data. */
export function summarizeWebToolValue(
  value: unknown,
  options: { allowPlainText?: boolean } = {},
): string {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return options.allowPlainText ? safeWebToolText(candidate, 700) : "";
    }
  }
  if (!isRecord(candidate)) return "";
  const safeFields = [
    "path",
    "filePath",
    "file",
    "cwd",
    "query",
    "pattern",
    "symbol",
    "url",
    "language",
    "description",
  ];
  const entries: string[] = [];
  for (const field of safeFields) {
    const fieldValue = candidate[field];
    if (
      typeof fieldValue !== "string" &&
      typeof fieldValue !== "number" &&
      typeof fieldValue !== "boolean"
    ) {
      continue;
    }
    const text = safeWebToolText(String(fieldValue), 220);
    if (text) entries.push(`${field}: ${text}`);
    if (entries.length >= 3) break;
  }
  return entries.join("\n");
}

/** Sanitize an action result crossing the Web UI boundary. */
export function sanitizeActionResult(result: {
  ok: boolean;
  message?: string;
}): { ok: boolean; message?: string } {
  return result.message
    ? { ok: result.ok, message: safeWebMessage(result.message) }
    : { ok: result.ok };
}

/** Sanitize a project action while preserving a locally selected path. */
export function sanitizeProjectActionResult(result: {
  ok: boolean;
  message?: string;
  path?: string;
  url?: string;
  cancelled?: boolean;
}): {
  ok: boolean;
  message?: string;
  path?: string;
  url?: string;
  cancelled?: boolean;
} {
  const url = sanitizeProjectWebUiUrl(result.url);
  return {
    ok: result.ok,
    ...(result.message ? { message: safeWebMessage(result.message) } : {}),
    ...(result.path ? { path: safeWebText(result.path, 4096) } : {}),
    ...(url ? { url } : {}),
    ...(result.cancelled ? { cancelled: true } : {}),
  };
}

function sanitizeProjectWebUiUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "::1", "localhost"].includes(url.hostname) ||
      url.username ||
      url.password ||
      !token ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(token)
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

/** Remove credentials and query data from a provider base URL. */
export function sanitizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return safeWebText(value, 500);
  }
}

/** Map request-boundary failures to an HTTP status without leaking details. */
export function webRequestErrorStatus(error: unknown): number {
  if (error instanceof z.ZodError) return 400;
  if (error instanceof Error && error.message === "Request body too large.") {
    return 413;
  }
  return 500;
}

/** Narrow an unknown failure to a Node error with an optional error code. */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function isRequestOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  return !origin || origin === `http://${req.headers.host}`;
}

function safeTokenMatch(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function readCookie(req: IncomingMessage, name: string): string {
  const rawCookie = req.headers.cookie;
  if (!rawCookie) return "";
  for (const item of rawCookie.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function sanitizeTokenUsage(
  value: unknown,
): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  return {
    inputTokens: safeNumber(value.inputTokens),
    outputTokens: safeNumber(value.outputTokens),
    cacheReadTokens: safeNumber(value.cacheReadTokens),
    cacheWriteTokens: safeNumber(value.cacheWriteTokens),
  };
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeWebText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return redactSecrets(stripAnsi(value)).slice(0, maxLength);
}

function safeWebToolText(value: string, maxLength: number): string {
  return safeWebText(value, maxLength)
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      "$1***REDACTED***",
    )
    .trim();
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
