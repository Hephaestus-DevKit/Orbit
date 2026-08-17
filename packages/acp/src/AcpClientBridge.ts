import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { resolve } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import {
  buildSanitizedChildEnvironment,
  HIDDEN_CHILD_PROCESS_OPTIONS,
  redactSecrets,
} from "@orbit-build/shared";
import { ExternalAgentConfigSchema } from "@orbit-build/config";

/** A user-owned ACP process. Provider, model, auth, and billing stay external. */
export const AcpExternalAgentConfigSchema = ExternalAgentConfigSchema;

export type AcpExternalAgentConfig = import("zod").infer<
  typeof AcpExternalAgentConfigSchema
>;

export interface AcpPermissionRequest {
  sessionId: string;
  title: string;
  toolCallId: string;
  options: Array<{ id: string; name: string; kind: string }>;
}

export interface AcpUpdateSnapshot {
  sessionId: string;
  sessionUpdate: string;
  receivedAt: string;
  data: unknown;
}

export interface AcpAgentCapabilitiesSnapshot {
  protocolVersion: number;
  name: string;
  title: string;
  version: string;
  authMethods: number;
  loadSession: boolean;
  promptImage: boolean;
  promptAudio: boolean;
  promptEmbeddedContext: boolean;
  sessionResume: boolean;
  sessionClose: boolean;
  sessionList: boolean;
}

export interface AcpRunResult {
  sessionId: string;
  stopReason: string;
  text: string;
  capabilities: AcpAgentCapabilitiesSnapshot;
  updateCount: number;
  updates: AcpUpdateSnapshot[];
  stderr: string;
  stderrTruncated: boolean;
  restoredSession?: {
    strategy: Exclude<AcpSessionRestoreStrategy, "auto">;
    replayedUpdateCount: number;
  };
}

export type AcpSessionRestoreStrategy = "auto" | "resume" | "load";

export interface AcpSessionInfoSnapshot {
  sessionId: string;
  cwd: string;
  additionalDirectories: string[];
  title?: string;
  updatedAt?: string;
}

export interface AcpSessionListResult {
  capabilities: AcpAgentCapabilitiesSnapshot;
  sessions: AcpSessionInfoSnapshot[];
  nextCursor?: string;
}

export interface AcpSessionControlResult {
  action: "close";
  sessionId: string;
  capabilities: AcpAgentCapabilitiesSnapshot;
}

export interface AcpSessionHistoryResult {
  sessionId: string;
  capabilities: AcpAgentCapabilitiesSnapshot;
  updates: AcpUpdateSnapshot[];
  updateCount: number;
  truncated: boolean;
}

export interface AcpBridgeOptions {
  cwd: string;
  config: AcpExternalAgentConfig;
  clientVersion: string;
  signal?: AbortSignal;
  onUpdate?: (update: AcpUpdateSnapshot) => void | Promise<void>;
  requestPermission?: (
    request: AcpPermissionRequest,
  ) => string | undefined | Promise<string | undefined>;
  maxUpdates?: number;
  maxTextBytes?: number;
  maxStderrBytes?: number;
  /** Continue an existing durable ACP session instead of creating a new one. */
  sessionId?: string;
  /** Prefer lightweight resume and fall back to load when set to auto. */
  sessionRestore?: AcpSessionRestoreStrategy;
  /** Internal lifecycle-only mode used by capability probes. */
  probeOnly?: boolean;
}

const DEFAULT_MAX_UPDATES = 2_000;
const DEFAULT_MAX_TEXT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 256 * 1024;

/**
 * Run one prompt against a stable ACP v1 agent over NDJSON stdio.
 *
 * Orbit deliberately advertises no client filesystem or terminal capability:
 * an external Agent may use its native tools, but it cannot silently route
 * host writes or commands through Orbit until an explicit bounded adapter is
 * installed.
 */
export async function runAcpAgentPrompt(
  prompt: string,
  options: AcpBridgeOptions,
): Promise<AcpRunResult> {
  const config = AcpExternalAgentConfigSchema.parse(options.config);
  if (!config.enabled) throw new Error("The selected ACP agent is disabled.");
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) throw new Error("ACP prompt cannot be empty.");
  const sessionId = normalizeSessionId(options.sessionId);
  const cwd = resolve(options.cwd);
  const environment = buildExternalAgentEnvironment(config);
  const child = spawn(config.command, config.args, {
    cwd,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
  });
  const stderr = createBoundedStderrCapture(
    child,
    options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
  );
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(
      new Error(`ACP request timed out after ${config.requestTimeoutMs}ms.`),
    );
  }, config.requestTimeoutMs);
  timer.unref();
  const relayAbort = () => deadline.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", relayAbort, { once: true });

  try {
    const operation = executeAcpPrompt(child, trimmedPrompt, {
      ...options,
      cwd,
      config,
      signal: deadline.signal,
      stderr,
      sessionId,
    });
    try {
      return await Promise.race([
        operation,
        rejectWhenAborted(deadline.signal),
        rejectWhenChildFails(child),
      ]);
    } catch (error) {
      return throwWithCapturedStderr(error, stderr);
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
    await terminateProcessTree(child);
  }
}

/** Perform only ACP initialization and capability negotiation. */
export async function probeAcpAgent(
  options: AcpBridgeOptions,
): Promise<AcpAgentCapabilitiesSnapshot> {
  const result = await runAcpAgentPrompt(
    "Reply with a single short readiness acknowledgement without using tools.",
    {
      ...options,
      maxUpdates: 100,
      maxTextBytes: 64 * 1024,
      probeOnly: true,
    },
  );
  return result.capabilities;
}

/**
 * List durable sessions exposed by an ACP agent.
 *
 * This is intentionally a separate short-lived control operation: session
 * metadata is never mixed into Orbit's provider catalog or persisted without
 * an explicit import action. Pagination is bounded so a hostile agent cannot
 * exhaust the client with an opaque cursor chain.
 */
export async function listAcpAgentSessions(
  options: AcpBridgeOptions,
): Promise<AcpSessionListResult> {
  return withAcpControlConnection(
    options,
    async ({ context, capabilities, signal, cwd }) => {
      if (!capabilities.sessionList) {
        throw new Error(
          "The ACP agent does not advertise session/list support.",
        );
      }
      const sessions: AcpSessionInfoSnapshot[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const result = await context.request(
          acp.methods.agent.session.list,
          {
            ...(cursor ? { cursor } : {}),
            cwd,
          },
          { cancellationSignal: signal },
        );
        for (const session of result.sessions.slice(0, 1_000)) {
          sessions.push({
            sessionId: String(session.sessionId).slice(0, 512),
            cwd: redactSecrets(String(session.cwd)).slice(0, 4_096),
            additionalDirectories: (session.additionalDirectories ?? [])
              .slice(0, 64)
              .map((directory) =>
                redactSecrets(String(directory)).slice(0, 4_096),
              ),
            ...(session.title
              ? { title: redactSecrets(String(session.title)).slice(0, 500) }
              : {}),
            ...(session.updatedAt
              ? { updatedAt: String(session.updatedAt).slice(0, 128) }
              : {}),
          });
        }
        const next = result.nextCursor ? String(result.nextCursor) : undefined;
        if (!next || next === cursor || next.length > 4_096) {
          cursor = undefined;
          break;
        }
        cursor = next;
      }
      return {
        capabilities,
        sessions,
        ...(cursor ? { nextCursor: cursor } : {}),
      };
    },
  );
}

/** Close one active durable ACP session after explicit caller intent. */
export async function closeAcpAgentSession(
  sessionId: string,
  options: AcpBridgeOptions,
): Promise<AcpSessionControlResult> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) throw new Error("ACP session id is required.");
  return withAcpControlConnection(
    options,
    async ({ context, capabilities, signal }) => {
      if (!capabilities.sessionClose) {
        throw new Error(
          "The ACP agent does not advertise session/close support.",
        );
      }
      await context.request(
        acp.methods.agent.session.close,
        { sessionId: normalizedSessionId },
        { cancellationSignal: signal },
      );
      return {
        action: "close",
        sessionId: normalizedSessionId,
        capabilities,
      };
    },
  );
}

/**
 * Load one durable ACP session as a bounded, read-only replay snapshot.
 * No prompt is sent and no replayed tool call is executed through Orbit.
 */
export async function loadAcpAgentSessionHistory(
  sessionId: string,
  options: AcpBridgeOptions,
): Promise<AcpSessionHistoryResult> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) throw new Error("ACP session id is required.");
  const updates: AcpUpdateSnapshot[] = [];
  const maxUpdates = clamp(
    options.maxUpdates ?? DEFAULT_MAX_UPDATES,
    1,
    10_000,
  );
  const maxBytes = clamp(
    options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES,
    1_024,
    64 * 1024 * 1024,
  );
  let updateCount = 0;
  let capturedBytes = 0;
  let truncated = false;
  return withAcpControlConnection(
    options,
    async ({ context, capabilities, signal, cwd }) => {
      if (!capabilities.loadSession) {
        throw new Error(
          "The ACP agent does not advertise session/load support.",
        );
      }
      await context.request(
        acp.methods.agent.session.load,
        { sessionId: normalizedSessionId, cwd, mcpServers: [] },
        { cancellationSignal: signal },
      );
      return {
        sessionId: normalizedSessionId,
        capabilities,
        updates,
        updateCount,
        truncated,
      };
    },
    async (notification) => {
      updateCount += 1;
      if (truncated) return;
      const snapshot = sanitizeUpdate(notification);
      const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
      if (updates.length >= maxUpdates || bytes > maxBytes - capturedBytes) {
        truncated = true;
        return;
      }
      updates.push(snapshot);
      capturedBytes += bytes;
      await options.onUpdate?.(snapshot);
    },
  );
}

interface AcpControlContext {
  context: acp.ClientContext;
  capabilities: AcpAgentCapabilitiesSnapshot;
  signal: AbortSignal;
  cwd: string;
}

async function withAcpControlConnection<T>(
  options: AcpBridgeOptions,
  operation: (control: AcpControlContext) => Promise<T>,
  onSessionUpdate?: (
    notification: acp.SessionNotification,
  ) => void | Promise<void>,
): Promise<T> {
  const config = AcpExternalAgentConfigSchema.parse(options.config);
  if (!config.enabled) throw new Error("The selected ACP agent is disabled.");
  const cwd = resolve(options.cwd);
  const child = spawn(config.command, config.args, {
    cwd,
    env: buildExternalAgentEnvironment(config),
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
  });
  const stderr = createBoundedStderrCapture(
    child,
    options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
  );
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(
      new Error(`ACP request timed out after ${config.requestTimeoutMs}ms.`),
    );
  }, config.requestTimeoutMs);
  timer.unref();
  const relayAbort = () => deadline.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", relayAbort, { once: true });
  try {
    const baseApp = acp.client({ name: "orbit" });
    const app = onSessionUpdate
      ? baseApp.onNotification(
          acp.methods.client.session.update,
          async ({ params }) => onSessionUpdate(params),
        )
      : baseApp;
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connected = app.connectWith(stream, async (context) => {
      const capabilities = await initializeAcpAgent(
        context,
        options.clientVersion,
        deadline.signal,
      );
      return operation({
        context,
        capabilities,
        signal: deadline.signal,
        cwd,
      });
    });
    try {
      return await Promise.race([
        connected,
        rejectWhenAborted(deadline.signal),
        rejectWhenChildFails(child),
      ]);
    } catch (error) {
      return throwWithCapturedStderr(error, stderr);
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", relayAbort);
    await terminateProcessTree(child);
  }
}

interface ExecuteOptions extends AcpBridgeOptions {
  cwd: string;
  config: AcpExternalAgentConfig;
  signal: AbortSignal;
  stderr: ReturnType<typeof createBoundedStderrCapture>;
}

async function executeAcpPrompt(
  child: ChildProcessWithoutNullStreams,
  prompt: string,
  options: ExecuteOptions,
): Promise<AcpRunResult> {
  const updates: AcpUpdateSnapshot[] = [];
  const maxUpdates = clamp(
    options.maxUpdates ?? DEFAULT_MAX_UPDATES,
    1,
    10_000,
  );
  const maxTextBytes = clamp(
    options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES,
    1_024,
    64 * 1024 * 1024,
  );
  let updateCount = 0;
  let replayedUpdateCount = 0;
  let replayingHistory = false;
  let text = "";
  const recordUpdate = async (
    notification: acp.SessionNotification,
  ): Promise<void> => {
    if (replayingHistory) {
      replayedUpdateCount += 1;
      return;
    }
    updateCount += 1;
    const snapshot = sanitizeUpdate(notification);
    if (updates.length < maxUpdates) updates.push(snapshot);
    const chunk = extractAgentText(notification.update);
    if (chunk && Buffer.byteLength(text, "utf8") < maxTextBytes) {
      const remaining = maxTextBytes - Buffer.byteLength(text, "utf8");
      text += truncateUtf8(redactSecrets(chunk), remaining);
    }
    await options.onUpdate?.(snapshot);
  };
  const baseApp = acp
    .client({ name: "orbit" })
    .onRequest(
      acp.methods.client.session.requestPermission,
      async ({ params }) => {
        if (options.config.permissionPolicy === "deny") {
          return { outcome: { outcome: "cancelled" } };
        }
        const request = toPermissionRequest(params);
        const selected = await options.requestPermission?.(request);
        if (
          !selected ||
          !request.options.some((item) => item.id === selected)
        ) {
          return { outcome: { outcome: "cancelled" } };
        }
        return {
          outcome: { outcome: "selected", optionId: selected },
        };
      },
    );
  const app = options.sessionId
    ? baseApp.onNotification(
        acp.methods.client.session.update,
        async ({ params }) => recordUpdate(params),
      )
    : baseApp;
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  return app.connectWith(stream, async (context) => {
    const capabilities = await initializeAcpAgent(
      context,
      options.clientVersion,
      options.signal,
    );
    const existingSessionId = options.sessionId;
    if (existingSessionId) {
      const strategy = resolveSessionRestoreStrategy(
        options.sessionRestore ?? "auto",
        capabilities,
      );
      replayingHistory = strategy === "load";
      try {
        if (strategy === "resume") {
          await context.request(
            acp.methods.agent.session.resume,
            {
              sessionId: existingSessionId,
              cwd: options.cwd,
              mcpServers: [],
            },
            { cancellationSignal: options.signal },
          );
        } else {
          await context.request(
            acp.methods.agent.session.load,
            {
              sessionId: existingSessionId,
              cwd: options.cwd,
              mcpServers: [],
            },
            { cancellationSignal: options.signal },
          );
        }
      } finally {
        replayingHistory = false;
      }
      const cancelSession = () => {
        void context.notify(acp.methods.agent.session.cancel, {
          sessionId: existingSessionId,
        });
      };
      options.signal.addEventListener("abort", cancelSession, { once: true });
      try {
        const response = await context.request(
          acp.methods.agent.session.prompt,
          {
            sessionId: existingSessionId,
            prompt: [{ type: "text", text: prompt }],
          },
          { cancellationSignal: options.signal },
        );
        const captured = options.stderr.snapshot();
        return {
          sessionId: existingSessionId,
          stopReason: String(response.stopReason),
          text,
          capabilities,
          updateCount,
          updates,
          stderr: captured.text,
          stderrTruncated: captured.truncated,
          restoredSession: { strategy, replayedUpdateCount },
        };
      } finally {
        options.signal.removeEventListener("abort", cancelSession);
      }
    }
    const session = await context
      .buildSession({ cwd: options.cwd, mcpServers: [] })
      .start({ cancellationSignal: options.signal });
    const cancelSession = () => {
      void context.notify(acp.methods.agent.session.cancel, {
        sessionId: session.sessionId,
      });
    };
    options.signal.addEventListener("abort", cancelSession, { once: true });
    try {
      if (options.probeOnly) {
        const captured = options.stderr.snapshot();
        return {
          sessionId: session.sessionId,
          stopReason: "initialized",
          text: "",
          capabilities,
          updateCount: 0,
          updates,
          stderr: captured.text,
          stderrTruncated: captured.truncated,
        };
      }
      void session.prompt(prompt, { cancellationSignal: options.signal });
      for (;;) {
        const message = await session.nextUpdate();
        if (message.kind === "stop") {
          const captured = options.stderr.snapshot();
          return {
            sessionId: session.sessionId,
            stopReason: String(message.stopReason),
            text,
            capabilities,
            updateCount,
            updates,
            stderr: captured.text,
            stderrTruncated: captured.truncated,
          };
        }
        await recordUpdate(message.notification);
      }
    } finally {
      options.signal.removeEventListener("abort", cancelSession);
      session.dispose();
    }
  });
}

function buildExternalAgentEnvironment(
  config: AcpExternalAgentConfig,
): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of config.inheritEnv) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return buildSanitizedChildEnvironment({
    mode: "minimal",
    extra: { ...inherited, ...config.env, ORBIT_EXTERNAL_AGENT: "1" },
  });
}

function toPermissionRequest(
  request: acp.RequestPermissionRequest,
): AcpPermissionRequest {
  return {
    sessionId: String(request.sessionId),
    title: redactSecrets(request.toolCall.title || "External Agent tool"),
    toolCallId: String(request.toolCall.toolCallId),
    options: request.options.map((option) => ({
      id: String(option.optionId),
      name: redactSecrets(option.name),
      kind: String(option.kind),
    })),
  };
}

async function initializeAcpAgent(
  context: acp.ClientContext,
  clientVersion: string,
  signal: AbortSignal,
): Promise<AcpAgentCapabilitiesSnapshot> {
  const initialized = await context.request(
    acp.methods.agent.initialize,
    {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: {
        name: "orbit",
        title: "Orbit",
        version: clientVersion,
      },
    },
    { cancellationSignal: signal },
  );
  if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported ACP protocol version ${initialized.protocolVersion}; Orbit supports ${acp.PROTOCOL_VERSION}.`,
    );
  }
  return summarizeCapabilities(initialized);
}

function summarizeCapabilities(
  response: acp.InitializeResponse,
): AcpAgentCapabilitiesSnapshot {
  const capabilities = response.agentCapabilities ?? {};
  const session = capabilities.sessionCapabilities;
  const prompt = capabilities.promptCapabilities;
  return {
    protocolVersion: Number(response.protocolVersion),
    name: redactSecrets(response.agentInfo?.name || "external-agent"),
    title: redactSecrets(
      response.agentInfo?.title || response.agentInfo?.name || "External Agent",
    ),
    version: redactSecrets(response.agentInfo?.version || "unknown"),
    authMethods: response.authMethods?.length ?? 0,
    loadSession: capabilities.loadSession === true,
    promptImage: prompt?.image === true,
    promptAudio: prompt?.audio === true,
    promptEmbeddedContext: prompt?.embeddedContext === true,
    sessionResume: Boolean(session?.resume),
    sessionClose: Boolean(session?.close),
    sessionList: Boolean(session?.list),
  };
}

function normalizeSessionId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const sessionId = value.trim();
  if (!sessionId) throw new Error("ACP session id cannot be empty.");
  if (sessionId.length > 512) {
    throw new Error("ACP session id cannot exceed 512 characters.");
  }
  if (/[\u0000-\u001F\u007F]/u.test(sessionId)) {
    throw new Error("ACP session id cannot contain control characters.");
  }
  return sessionId;
}

function resolveSessionRestoreStrategy(
  requested: AcpSessionRestoreStrategy,
  capabilities: AcpAgentCapabilitiesSnapshot,
): Exclude<AcpSessionRestoreStrategy, "auto"> {
  if (requested === "resume") {
    if (!capabilities.sessionResume) {
      throw new Error(
        "The ACP agent does not advertise session/resume support.",
      );
    }
    return "resume";
  }
  if (requested === "load") {
    if (!capabilities.loadSession) {
      throw new Error("The ACP agent does not advertise session/load support.");
    }
    return "load";
  }
  if (capabilities.sessionResume) return "resume";
  if (capabilities.loadSession) return "load";
  throw new Error(
    "The ACP agent cannot continue durable sessions: neither session/resume nor session/load is advertised.",
  );
}

function sanitizeUpdate(
  notification: acp.SessionNotification,
): AcpUpdateSnapshot {
  const serialized = JSON.stringify(notification.update);
  const bounded = redactSecrets(serialized).slice(0, 128 * 1024);
  let data: unknown = bounded;
  try {
    data = JSON.parse(bounded);
  } catch {
    // A truncated update remains a safe diagnostic string.
  }
  return {
    sessionId: String(notification.sessionId),
    sessionUpdate: String(notification.update.sessionUpdate),
    receivedAt: new Date().toISOString(),
    data,
  };
}

function extractAgentText(update: acp.SessionUpdate): string {
  if (
    update.sessionUpdate === "agent_message_chunk" &&
    update.content.type === "text"
  ) {
    return update.content.text;
  }
  return "";
}

function createBoundedStderrCapture(
  child: ChildProcessWithoutNullStreams,
  rawLimit: number,
) {
  const limit = clamp(rawLimit, 1_024, 4 * 1024 * 1024);
  let text = "";
  let bytes = 0;
  let truncated = false;
  child.stderr.on("data", (chunk: Buffer | string) => {
    if (bytes >= limit) {
      truncated = true;
      return;
    }
    const value = redactSecrets(String(chunk));
    const remaining = limit - bytes;
    const bounded = truncateUtf8(value, remaining);
    text += bounded;
    bytes += Buffer.byteLength(bounded, "utf8");
    if (Buffer.byteLength(value, "utf8") > remaining) truncated = true;
  });
  return {
    snapshot: () => ({ text: text.trim(), truncated }),
  };
}

function throwWithCapturedStderr(
  error: unknown,
  stderr: ReturnType<typeof createBoundedStderrCapture>,
): never {
  const captured = stderr.snapshot();
  if (!captured.text) throw error;
  const message = error instanceof Error ? error.message : String(error);
  const truncation = captured.truncated ? " (truncated)" : "";
  throw new Error(
    `${message}\nACP agent stderr${truncation}: ${captured.text}`,
    {
      cause: error,
    },
  );
}

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const rejectAbort = () =>
      reject(signal.reason ?? new Error("ACP request was cancelled."));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener("abort", rejectAbort, { once: true });
  });
}

function rejectWhenChildFails(
  child: ChildProcessWithoutNullStreams,
): Promise<never> {
  return new Promise((_, reject) => {
    child.once("error", (error) => reject(error));
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `ACP agent exited before the turn completed (${signal || `code ${code ?? "unknown"}`}).`,
        ),
      );
    });
  });
}

async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      HIDDEN_CHILD_PROCESS_OPTIONS,
    );
    await new Promise<void>((resolveDone) => {
      killer.once("error", () => resolveDone());
      killer.once("exit", () => resolveDone());
    });
    return;
  }
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolveDone) => {
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The process already exited.
      }
      resolveDone();
    }, 1_000);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolveDone();
    });
  });
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) return value;
  return buffer
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD$/u, "");
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}
