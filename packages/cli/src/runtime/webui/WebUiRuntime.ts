import http, { type IncomingMessage, type ServerResponse } from "http";
import { randomBytes, randomUUID } from "crypto";
import { isAbsolute, relative, resolve } from "path";
import { z } from "zod";
import { OrbitLanguageSchema } from "@orbit-build/config";
import { resolveSkillDirectories } from "@orbit-build/context-engine";
import {
  getAutocompleteCandidates,
  type AutocompleteCandidates,
} from "../AutocompleteCandidates.js";
import {
  type ActiveWebTurn,
  type WebUiHandle,
  type WebUiImageAttachment,
  type WebUiInputQueueAction,
  type WebUiOptions,
  type WebUiTaskAction,
} from "./WebUiContracts.js";
import { WEB_UI_CLIENT_SCRIPT } from "./WebUiClient.js";
import { WEB_UI_FAVICON_SVG } from "./WebUiBrand.js";
import {
  collectWebUiMessagePage,
  collectWebUiSettings,
  collectWebUiSkills,
  collectWebUiStatus,
  filterWebUiCompletionFiles,
} from "./WebUiData.js";
import { WebUiEventStream } from "./WebUiEventStream.js";
import {
  bootstrapWebSession,
  readBinaryBody,
  readJsonBody,
  sendAsset,
  sendHtml,
  sendJson,
} from "./WebUiHttp.js";
import { renderWebUiPage } from "./WebUiPage.js";
import {
  isAuthorizedWebRequest,
  isAuthorizedWebEventRequest,
  isBearerAuthorizedWebRequest,
  isNodeError,
  safeWebMessage,
  sanitizeActionResult,
  sanitizeProjectActionResult,
  webRequestErrorStatus,
} from "./WebUiSecurity.js";
import { WEB_UI_STYLES } from "./WebUiStyles.js";
import { createProjectCapability } from "../CapabilityScaffolder.js";

const WebTurnIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const AttachmentIdsSchema = z
  .array(WebTurnIdSchema)
  .max(4)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Attachment IDs must be unique.",
  });
const MessagePageQuerySchema = z
  .object({
    before: z.coerce.number().int().min(1).max(10_000_000).optional(),
    limit: z.coerce.number().int().min(20).max(100).optional(),
  })
  .strict();
const ChatRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(100_000),
    turnId: WebTurnIdSchema.optional(),
    attachmentIds: AttachmentIdsSchema.optional(),
  })
  .strict();
const InputQueueIdSchema = z
  .string()
  .trim()
  .regex(/^input_[a-zA-Z0-9_-]+$/)
  .max(200);
const InputQueueActionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("enqueue"),
        prompt: z.string().trim().min(1).max(100_000),
        mode: z.enum(["follow_up", "steer"]).default("follow_up"),
        attachmentIds: AttachmentIdsSchema.optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("update"),
        inputId: InputQueueIdSchema,
        prompt: z.string().trim().min(1).max(100_000).optional(),
        mode: z.enum(["follow_up", "steer"]).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("move"),
        inputId: InputQueueIdSchema,
        direction: z.enum(["up", "down"]),
      })
      .strict(),
    z
      .object({
        action: z.literal("remove"),
        inputId: InputQueueIdSchema,
      })
      .strict(),
    z.object({ action: z.literal("clear") }).strict(),
  ])
  .superRefine((action, context) => {
    if (
      action.action === "update" &&
      action.prompt === undefined &&
      action.mode === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A queued-input update must change the prompt or mode.",
      });
    }
  });
const CancelRequestSchema = z
  .object({ turnId: WebTurnIdSchema.nullish() })
  .strict();
const ApprovalDecisionSchema = z
  .object({
    id: WebTurnIdSchema,
    approved: z.boolean(),
  })
  .strict();
const SettingsPatchSchema = z
  .object({
    language: OrbitLanguageSchema.optional(),
    provider: z.string().trim().min(1).max(256).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    permissionMode: z.enum(["strict", "normal", "auto", "plan"]).optional(),
    webSearchEnabled: z.boolean().optional(),
    webSearchProvider: z
      .enum(["auto", "searxng", "tavily", "bing", "duckduckgo"])
      .optional(),
    webSearchMaxResults: z.number().int().min(1).max(20).optional(),
    skillsEnabled: z.boolean().optional(),
    skillsActivation: z.enum(["auto", "explicit"]).optional(),
    skillsMaxActive: z.number().int().min(0).max(8).optional(),
    skillsDisabled: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/))
      .max(200)
      .optional(),
  })
  .strict();
const CapabilityNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const CapabilityCreateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("skill"),
      name: CapabilityNameSchema,
      description: z.string().trim().min(1).max(2_000),
      instructions: z.string().trim().min(1).max(24_000),
      scope: z.enum(["local", "versioned"]).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("workflow"),
      name: CapabilityNameSchema,
      description: z.string().trim().min(1).max(240),
      instructions: z.string().trim().min(1).max(24_000),
      skills: z.array(CapabilityNameSchema).max(8),
      argumentHint: z.string().trim().min(1).max(160).optional(),
    })
    .strict(),
]);
const SessionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("new") }).strict(),
  ...(["resume", "archive", "restore", "delete"] as const).map((action) =>
    z
      .object({
        action: z.literal(action),
        sessionId: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/^[a-zA-Z0-9_-]+$/),
      })
      .strict(),
  ),
]);
const ProjectPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "Project paths cannot contain control characters.",
  });
const ProjectActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pick") }).strict(),
  z
    .object({
      action: z.enum(["open", "create"]),
      path: ProjectPathSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("remove"),
      projectId: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-zA-Z0-9_-]+$/),
    })
    .strict(),
]);
const ReviewActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("rollback-file"),
      path: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      action: z.literal("rewind"),
      checkpointId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[a-zA-Z0-9_-]+$/),
    })
    .strict(),
]);
const WebAgentIdSchema = z
  .string()
  .regex(/^agent_[a-z0-9-]+$/)
  .max(128);
const WebAgentRunIdSchema = z
  .string()
  .regex(/^run_[a-z0-9-]+$/)
  .max(128);
const AgentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("abort"), agentId: WebAgentIdSchema }).strict(),
  z
    .object({
      action: z.literal("steer"),
      agentId: WebAgentIdSchema,
      prompt: z.string().trim().min(1).max(8_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("resume"),
      runId: WebAgentRunIdSchema,
      agentId: WebAgentIdSchema,
    })
    .strict(),
]);
const TaskActionSchema = z
  .object({
    action: z.enum(["plan", "parallel-improve"]),
    turnId: WebTurnIdSchema.optional(),
  })
  .strict();
const CompletionQuerySchema = z.string().trim().max(200);
const IMAGE_ATTACHMENT_LIMIT_BYTES = 5 * 1024 * 1024;
const IMAGE_ATTACHMENT_STORE_LIMIT = 16;
const COMPLETION_CACHE_TTL_MS = 2_000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

type RuntimeState = "idle" | "starting" | "running" | "stopping" | "stopped";

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolveListen, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolveListen(
        typeof address === "object" && address ? address.port : port,
      );
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * A single-use Orbit Web UI server instance. All mutable request, turn,
 * authentication, and event-stream state belongs to this instance.
 */
export class OrbitWebUiRuntime {
  private options: WebUiOptions;
  private readonly events: WebUiEventStream;
  private state: RuntimeState = "idle";
  private token: string | undefined;
  private activeTurn: ActiveWebTurn | undefined;
  private projectActionPending = false;
  private server: http.Server | undefined;
  private handle: WebUiHandle | undefined;
  private stopPromise: Promise<void> | undefined;
  private completionCandidatesPromise:
    | Promise<AutocompleteCandidates>
    | undefined;
  private completionCandidatesCachedAt = 0;
  private readonly attachments = new Map<string, WebUiImageAttachment>();
  private pendingAttachmentUploads = 0;

  public constructor(options: WebUiOptions) {
    this.options = options;
    this.events = new WebUiEventStream(() => this.activeTurn);
  }

  /** Whether this instance currently accepts Web UI requests. */
  public get isRunning(): boolean {
    return this.state === "running";
  }

  /** Whether a prompt owned by this instance has not completed yet. */
  public get hasActiveTurn(): boolean {
    return this.activeTurn !== undefined;
  }

  /** Determine whether a start request may reuse this listening instance. */
  public canReuse(port: number | undefined): boolean {
    return (
      this.state === "running" &&
      this.handle !== undefined &&
      (!port || port === this.handle.port)
    );
  }

  /** Replace request dependencies when an existing port is reused. */
  public updateOptions(options: WebUiOptions): void {
    if (this.state !== "running") {
      throw new Error("Orbit Web UI is not running.");
    }
    this.options = options;
    this.completionCandidatesPromise = undefined;
    this.completionCandidatesCachedAt = 0;
  }

  /** Return this instance's live public handle. */
  public getHandle(): WebUiHandle {
    if (this.state !== "running" || !this.handle) {
      throw new Error("Orbit Web UI is not running.");
    }
    return this.handle;
  }

  /** Bind the loopback HTTP server and attach this instance's event bridge. */
  public async start(): Promise<WebUiHandle> {
    if (this.state !== "idle") {
      throw new Error("A Web UI runtime instance can only be started once.");
    }
    this.state = "starting";
    this.token = randomBytes(32).toString("base64url");
    const preferredPort = this.options.port ?? 6047;
    const attempts =
      preferredPort === 0
        ? [0]
        : Array.from({ length: 20 }, (_, index) => preferredPort + index);
    let lastError: unknown;

    for (const port of attempts) {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((error: unknown) => {
          sendJson(res, 500, { ok: false, message: safeWebMessage(error) });
        });
      });
      try {
        const actualPort = await listen(server, port);
        const token = this.token;
        if (!token) throw new Error("Orbit Web UI authentication failed.");
        this.server = server;
        this.state = "running";
        this.events.start();
        const handle: WebUiHandle = {
          port: actualPort,
          url: `http://127.0.0.1:${actualPort}/#token=${encodeURIComponent(token)}`,
          browserOpened: false,
          close: () => this.stop(),
        };
        this.handle = handle;
        return handle;
      } catch (error: unknown) {
        lastError = error;
        if (
          !isNodeError(error) ||
          error.code !== "EADDRINUSE" ||
          preferredPort === 0
        ) {
          this.token = undefined;
          this.state = "stopped";
          throw error;
        }
      }
    }

    this.token = undefined;
    this.state = "stopped";
    throw lastError instanceof Error
      ? lastError
      : new Error("Unable to start Orbit Web UI.");
  }

  /**
   * Permanently stop this instance. Outstanding prompt promises may settle,
   * but their completion events remain confined to this stopped runtime.
   */
  public stop(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  private async stopInternal(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopping";
    this.events.stop();
    this.activeTurn = undefined;
    this.token = undefined;
    this.handle = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      });
    }
    // An upload that was already reading its bounded body may finish while the
    // server closes. Clear only after those request handlers have settled.
    this.attachments.clear();
    this.pendingAttachmentUploads = 0;
    this.state = "stopped";
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (this.state !== "running") {
      sendJson(res, 503, { error: "Orbit Web UI is not initialized." });
      return;
    }
    const options = this.options;
    const token = this.token;
    const host = req.headers.host || "";
    if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) {
      sendJson(res, 403, { error: "Invalid Host header." });
      return;
    }
    // The Host header is validated above, so request routing does not need to
    // incorporate it into the URL base. A fixed loopback base also keeps URL
    // parsing stable across browser/proxy variants that preserve an absolute
    // request target.
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(res, 200, renderWebUiPage(options.config.language));
      return;
    }
    if (req.method === "GET" && url.pathname === "/assets/orbit.css") {
      sendAsset(res, "text/css", WEB_UI_STYLES);
      return;
    }
    if (req.method === "GET" && url.pathname === "/assets/orbit.js") {
      sendAsset(res, "text/javascript", WEB_UI_CLIENT_SCRIPT);
      return;
    }
    if (req.method === "GET" && url.pathname === "/assets/orbit-mark.svg") {
      sendAsset(res, "image/svg+xml", WEB_UI_FAVICON_SVG);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/bootstrap") {
      if (!isBearerAuthorizedWebRequest(req, token)) {
        sendJson(res, 401, { error: "Unauthorized." });
        return;
      }
      bootstrapWebSession(res, token || "");
      return;
    }
    const isEventStream =
      req.method === "GET" && url.pathname === "/api/events";
    const isAuthorized = isEventStream
      ? isAuthorizedWebRequest(req, token) ||
        isAuthorizedWebEventRequest(req, token, url)
      : isAuthorizedWebRequest(req, token);
    if (!isAuthorized) {
      sendJson(res, 401, { error: "Unauthorized." });
      return;
    }
    const isAttachmentUpload =
      req.method === "POST" && url.pathname === "/api/attachment";
    if (
      req.method === "POST" &&
      !isAttachmentUpload &&
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      sendJson(res, 415, { error: "Content-Type must be application/json." });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, collectWebUiStatus(options, this.activeTurn));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/messages") {
      const query = MessagePageQuerySchema.safeParse(
        Object.fromEntries(url.searchParams),
      );
      if (!query.success) {
        sendJson(res, 400, { error: "Invalid message page query." });
        return;
      }
      sendJson(res, 200, collectWebUiMessagePage(options.loop, query.data));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, collectWebUiSettings(options));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/skills") {
      sendJson(res, 200, await collectWebUiSkills(options));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/trace") {
      if (!options.exportTrace) {
        sendJson(res, 409, {
          ok: false,
          message: "Trace export is not available.",
        });
        return;
      }
      try {
        const includeHistory = url.searchParams.get("history") !== "0";
        sendJson(res, 200, options.exportTrace(includeHistory));
      } catch (error: unknown) {
        sendJson(res, webRequestErrorStatus(error), {
          ok: false,
          message: safeWebMessage(error),
        });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/completions") {
      const query = CompletionQuerySchema.safeParse(
        url.searchParams.get("query") || "",
      );
      if (!query.success) {
        sendJson(res, 400, { error: "Invalid completion query." });
        return;
      }
      const candidates = await this.getCompletionCandidates(options);
      const normalizedQuery = query.data.trim().toLowerCase();
      sendJson(res, 200, {
        files: filterWebUiCompletionFiles(candidates.files, query.data),
        commands: candidates.commands.filter(
          (command) => !normalizedQuery || command.includes(normalizedQuery),
        ),
        commandDetails: (candidates.commandDetails ?? []).filter(
          ({ command }) =>
            !normalizedQuery || command.includes(normalizedQuery),
        ),
        total: candidates.files.length,
      });
      return;
    }
    if (isAttachmentUpload) {
      await this.handleAttachmentUpload(req, res, url);
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/api/attachment") {
      const id = WebTurnIdSchema.safeParse(url.searchParams.get("id") || "");
      if (!id.success) {
        sendJson(res, 400, { ok: false, message: "Invalid attachment ID." });
        return;
      }
      this.attachments.delete(id.data);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (isEventStream) {
      this.events.attach(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      await this.handleChat(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/input-queue") {
      await this.handleInputQueue(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/task") {
      await this.handleTask(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      await this.handleSettings(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/capability") {
      await this.handleCapability(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/session") {
      await this.handleSession(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/project") {
      await this.handleProject(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/review") {
      await this.handleReview(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/agent") {
      await this.handleAgentAction(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cancel") {
      await this.handleCancel(req, res, options);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/approval") {
      await this.handleApproval(req, res, options);
      return;
    }
    sendJson(res, 404, { error: "Not found" });
  }

  private async handleAttachmentUpload(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    let slotReserved = false;
    try {
      const mediaType = String(req.headers["content-type"] || "")
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(mediaType)) {
        sendJson(res, 415, {
          ok: false,
          message: "Use a PNG, JPEG, GIF, or WebP image.",
        });
        return;
      }
      if (
        this.attachments.size + this.pendingAttachmentUploads >=
        IMAGE_ATTACHMENT_STORE_LIMIT
      ) {
        sendJson(res, 429, {
          ok: false,
          message:
            "Too many pending attachments. Remove an image or retry later.",
        });
        return;
      }
      this.pendingAttachmentUploads += 1;
      slotReserved = true;
      const body = await readBinaryBody(req, IMAGE_ATTACHMENT_LIMIT_BYTES);
      if (body.length === 0) {
        sendJson(res, 400, { ok: false, message: "Attachment is empty." });
        return;
      }
      if (!matchesImageSignature(mediaType, body)) {
        sendJson(res, 415, {
          ok: false,
          message: "The uploaded bytes do not match the declared image type.",
        });
        return;
      }
      const id = `att_${randomUUID().replace(/-/g, "")}`;
      const rawName = url.searchParams.get("name") || "image";
      const name =
        rawName
          .replace(/[\u0000-\u001f\u007f\\/]/g, "_")
          .trim()
          .slice(0, 255) || "image";
      const attachment: WebUiImageAttachment = {
        id,
        name,
        mediaType: mediaType as WebUiImageAttachment["mediaType"],
        data: body.toString("base64"),
        size: body.length,
      };
      this.attachments.set(id, attachment);
      sendJson(res, 201, {
        ok: true,
        attachment: { id, name, mediaType, size: body.length },
      });
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    } finally {
      if (slotReserved) this.pendingAttachmentUploads -= 1;
    }
  }

  private async handleReview(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.updateReview) {
      sendJson(res, 409, {
        ok: false,
        message: "Change review actions are not available.",
      });
      return;
    }
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message: "Wait for the active task to finish before restoring files.",
      });
      return;
    }
    try {
      const action = ReviewActionSchema.parse(await readJsonBody(req));
      const result = sanitizeActionResult(await options.updateReview(action));
      sendJson(res, result.ok ? 200 : 409, result);
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleAgentAction(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.controlAgent) {
      sendJson(res, 409, {
        ok: false,
        message: "Agent controls are not available.",
      });
      return;
    }
    try {
      const action = AgentActionSchema.parse(await readJsonBody(req));
      const result = sanitizeActionResult(await options.controlAgent(action));
      sendJson(res, result.ok ? 200 : 409, result);
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleApproval(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.respondToApproval) {
      sendJson(res, 409, {
        ok: false,
        message: "Approval bridge is not available.",
      });
      return;
    }
    try {
      const decision = ApprovalDecisionSchema.parse(await readJsonBody(req));
      const result = sanitizeActionResult(
        await options.respondToApproval(decision),
      );
      sendJson(res, result.ok ? 200 : 409, result);
    } catch (error) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleProject(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.openProject) {
      sendJson(res, 409, {
        ok: false,
        message: "Project launcher is not available.",
      });
      return;
    }
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message: "Wait for the active task to finish before opening a project.",
      });
      return;
    }
    try {
      const action = ProjectActionSchema.parse(await readJsonBody(req));
      if (this.projectActionPending) {
        sendJson(res, 409, {
          ok: false,
          message: "Another project action is already in progress.",
        });
        return;
      }
      this.projectActionPending = true;
      try {
        const result = sanitizeProjectActionResult(
          await options.openProject(action),
        );
        sendJson(
          res,
          result.ok
            ? action.action === "remove" || action.action === "pick"
              ? 200
              : 202
            : 409,
          result,
        );
      } finally {
        this.projectActionPending = false;
      }
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private getCompletionCandidates(
    options: WebUiOptions,
  ): Promise<AutocompleteCandidates> {
    const now = Date.now();
    if (
      !this.completionCandidatesPromise ||
      now - this.completionCandidatesCachedAt >= COMPLETION_CACHE_TTL_MS
    ) {
      const request = getAutocompleteCandidates(
        options.cwd,
        options.config,
      ).then((candidates) => ({
        ...candidates,
        files: candidates.files.slice(
          0,
          options.config.context.maxFilesToIndex,
        ),
      }));
      this.completionCandidatesPromise = request;
      this.completionCandidatesCachedAt = now;
      void request.catch(() => {
        if (this.completionCandidatesPromise === request) {
          this.invalidateCompletionCandidates();
        }
      });
    }
    return this.completionCandidatesPromise;
  }

  private invalidateCompletionCandidates(): void {
    this.completionCandidatesPromise = undefined;
    this.completionCandidatesCachedAt = 0;
  }

  private async handleChat(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.submitPrompt) {
      sendJson(res, 409, {
        ok: false,
        message: "Chat bridge is not available.",
      });
      return;
    }
    try {
      const body = ChatRequestSchema.parse(await readJsonBody(req));
      if (this.activeTurn) {
        sendJson(res, 409, {
          ok: false,
          message: "Orbit is already processing a request.",
          turnId: this.activeTurn.id,
        });
        return;
      }
      const turn: ActiveWebTurn = {
        id: body.turnId || randomUUID(),
        sessionId: safeCall(() => options.loop?.getSessionId?.()) || "",
        startedAt: new Date().toISOString(),
        cancelRequested: false,
      };
      const attachments = (body.attachmentIds || []).map((id) => {
        const attachment = this.attachments.get(id);
        if (!attachment)
          throw new Error(`Attachment is no longer available: ${id}`);
        return attachment;
      });
      this.activeTurn = turn;
      this.events.broadcast({
        kind: "turn_started",
        turnId: turn.id,
        sessionId: turn.sessionId,
        startedAt: turn.startedAt,
      });
      sendJson(res, 202, { ok: true, turnId: turn.id });
      void this.runWebTurn(
        turn,
        () => options.submitPrompt?.(body.prompt, attachments),
        attachments,
      );
    } catch (error) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleInputQueue(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.updateInputQueue) {
      sendJson(res, 409, {
        ok: false,
        message: "The shared input queue is not available.",
      });
      return;
    }
    try {
      const request = InputQueueActionSchema.parse(await readJsonBody(req));
      let action: WebUiInputQueueAction;
      let queuedAttachments: WebUiImageAttachment[] = [];
      if (request.action === "enqueue") {
        queuedAttachments = (request.attachmentIds || []).map((id) => {
          const attachment = this.attachments.get(id);
          if (!attachment) {
            throw new Error(`Attachment is no longer available: ${id}`);
          }
          return attachment;
        });
        action = {
          action: "enqueue",
          prompt: request.prompt,
          mode: request.mode,
          attachments: queuedAttachments,
        };
      } else {
        action = request;
      }
      const result = sanitizeActionResult(
        await options.updateInputQueue(action),
      );
      if (result.ok) {
        for (const attachment of queuedAttachments) {
          this.attachments.delete(attachment.id);
        }
      }
      sendJson(res, result.ok ? 200 : 409, result);
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleTask(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.startTask) {
      sendJson(res, 409, {
        ok: false,
        message: "Task actions are not available.",
      });
      return;
    }
    try {
      const body = TaskActionSchema.parse(await readJsonBody(req));
      const action: WebUiTaskAction = { action: body.action };
      if (this.activeTurn) {
        sendJson(res, 409, {
          ok: false,
          message: "Orbit is already processing a request.",
          turnId: this.activeTurn.id,
        });
        return;
      }
      const turn: ActiveWebTurn = {
        id: body.turnId || randomUUID(),
        sessionId: safeCall(() => options.loop?.getSessionId?.()) || "",
        startedAt: new Date().toISOString(),
        cancelRequested: false,
      };
      this.activeTurn = turn;
      this.events.broadcast({
        kind: "turn_started",
        turnId: turn.id,
        sessionId: turn.sessionId,
        startedAt: turn.startedAt,
      });
      sendJson(res, 202, { ok: true, turnId: turn.id });
      void this.runWebTurn(turn, () => options.startTask?.(action));
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async runWebTurn(
    turn: ActiveWebTurn,
    execute: () =>
      | Promise<{ ok: boolean; message?: string } | undefined>
      | { ok: boolean; message?: string }
      | undefined,
    attachments: WebUiImageAttachment[] = [],
  ): Promise<void> {
    let status: "completed" | "failed" | "aborted" = "completed";
    let message: string | undefined;
    try {
      const result = await execute();
      if (turn.cancelRequested) {
        status = "aborted";
      } else if (!result?.ok) {
        status = "failed";
        message = safeWebMessage(
          result?.message || "Orbit could not complete the request.",
        );
      }
    } catch (error: unknown) {
      status = turn.cancelRequested ? "aborted" : "failed";
      message = safeWebMessage(error);
    } finally {
      for (const attachment of attachments)
        this.attachments.delete(attachment.id);
      if (this.activeTurn === turn) this.activeTurn = undefined;
      this.events.broadcast({
        kind: "turn_done",
        turnId: turn.id,
        sessionId: turn.sessionId,
        status,
        ok: status === "completed",
        ...(message ? { message } : {}),
      });
    }
  }

  private async handleSettings(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.updateSettings) {
      sendJson(res, 409, {
        ok: false,
        message: "Settings bridge is not available.",
      });
      return;
    }
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message: "Wait for the active task to finish before changing settings.",
      });
      return;
    }
    try {
      const patch = SettingsPatchSchema.parse(await readJsonBody(req));
      const result = await options.updateSettings(patch);
      sendJson(res, result.ok ? 200 : 400, sanitizeActionResult(result));
    } catch (error) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleCapability(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message:
          "Wait for the active task to finish before adding capabilities.",
      });
      return;
    }
    try {
      const request = CapabilityCreateSchema.parse(await readJsonBody(req));
      if (
        request.kind === "skill" &&
        !isSkillScopeDiscoverable(
          options.cwd,
          options.config.skills.directories,
          request.scope ?? "local",
        )
      ) {
        const directory =
          request.scope === "versioned" ? ".agents/skills" : ".orbit/skills";
        sendJson(res, 400, {
          ok: false,
          message: `The selected Skill storage is not discoverable. Add "${directory}" to skills.directories first.`,
        });
        return;
      }
      if (request.kind === "workflow" && request.skills.length > 0) {
        const catalog = await collectWebUiSkills(options);
        const availableSkills = new Set(
          catalog.skills.map((skill) => skill.name),
        );
        const missingSkills = request.skills.filter(
          (skill) => !availableSkills.has(skill),
        );
        if (missingSkills.length > 0) {
          sendJson(res, 400, {
            ok: false,
            message: `Unknown Skill${missingSkills.length === 1 ? "" : "s"}: ${missingSkills.join(", ")}`,
          });
          return;
        }
      }
      const created = await createProjectCapability(options.cwd, request);
      this.invalidateCompletionCandidates();
      options.invalidateSkills?.();
      sendJson(res, 201, { ok: true, capability: created });
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleCancel(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    try {
      const body = CancelRequestSchema.parse(await readJsonBody(req));
      const turn = this.activeTurn;
      if (!turn) {
        if (!options.cancelPrompt) {
          sendJson(res, 409, {
            ok: false,
            message: "Nothing is currently running.",
          });
          return;
        }
        const result = await options.cancelPrompt();
        sendJson(res, result.ok ? 200 : 409, sanitizeActionResult(result));
        return;
      }
      if (body.turnId && body.turnId !== turn.id) {
        sendJson(res, 409, {
          ok: false,
          message: "The active turn has changed.",
        });
        return;
      }
      if (!options.cancelPrompt) {
        sendJson(res, 409, {
          ok: false,
          message: "Cancellation is not available.",
        });
        return;
      }
      turn.cancelRequested = true;
      const result = await options.cancelPrompt();
      if (!result.ok && this.activeTurn === turn) {
        turn.cancelRequested = false;
      }
      sendJson(res, result.ok ? 200 : 409, sanitizeActionResult(result));
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }

  private async handleSession(
    req: IncomingMessage,
    res: ServerResponse,
    options: WebUiOptions,
  ): Promise<void> {
    if (!options.updateSession) {
      sendJson(res, 409, {
        ok: false,
        message: "Session navigation is not available.",
      });
      return;
    }
    if (this.activeTurn) {
      sendJson(res, 409, {
        ok: false,
        message: "Wait for the active task to finish before changing sessions.",
      });
      return;
    }
    try {
      const action = SessionActionSchema.parse(await readJsonBody(req));
      const result = await options.updateSession(action);
      sendJson(res, result.ok ? 200 : 409, sanitizeActionResult(result));
    } catch (error: unknown) {
      sendJson(res, webRequestErrorStatus(error), {
        ok: false,
        message: safeWebMessage(error),
      });
    }
  }
}

function isSkillScopeDiscoverable(
  cwd: string,
  configuredDirectories: string[],
  scope: "local" | "versioned",
): boolean {
  const target = resolve(
    cwd,
    scope === "versioned" ? ".agents/skills" : ".orbit/skills",
  );
  return resolveSkillDirectories(cwd, configuredDirectories).some((root) => {
    const pathFromRoot = relative(root, target);
    return (
      pathFromRoot === "" ||
      (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
    );
  });
}

function matchesImageSignature(mediaType: string, body: Buffer): boolean {
  if (mediaType === "image/png") {
    return (
      body.length >= 8 &&
      body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (mediaType === "image/jpeg") {
    return (
      body.length >= 3 &&
      body[0] === 0xff &&
      body[1] === 0xd8 &&
      body[2] === 0xff
    );
  }
  if (mediaType === "image/gif") {
    return (
      body.length >= 6 &&
      ["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii"))
    );
  }
  return (
    mediaType === "image/webp" &&
    body.length >= 12 &&
    body.subarray(0, 4).toString("ascii") === "RIFF" &&
    body.subarray(8, 12).toString("ascii") === "WEBP"
  );
}
