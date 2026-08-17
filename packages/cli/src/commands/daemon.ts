import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { promisify } from "util";
import picocolors from "picocolors";
import {
  DaemonClient,
  DaemonServer,
  DaemonStore,
  DaemonTokenStore,
  DaemonTaskIdSchema,
  DaemonAuditLog,
  JwtDaemonAuthenticator,
  type DaemonTaskRecord,
  type DaemonTaskRunner,
} from "@orbit-build/daemon";
import {
  HIDDEN_CHILD_PROCESS_OPTIONS,
  buildInheritedChildEnvironment,
  readBoundedRegularFile,
  redactSecrets,
  replacePrivateFileAtomically,
  ensurePrivateDirectory,
} from "@orbit-build/shared";
import { spawn } from "child_process";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const DAEMON_METADATA_SCHEMA_VERSION = 1 as const;
const DAEMON_ROOT_NAME = ".orbit/daemon";
const MAX_METADATA_BYTES = 64 * 1024;

interface DaemonMetadata {
  schemaVersion: typeof DAEMON_METADATA_SCHEMA_VERSION;
  protocolVersion: 1;
  pid: number;
  startedAt: string;
  host: string;
  port: number;
  protocol: "http" | "https";
  tokenPath: string;
  roots: string[];
}

const DaemonMetadataSchema = z
  .object({
    schemaVersion: z.literal(DAEMON_METADATA_SCHEMA_VERSION),
    protocolVersion: z.literal(1),
    pid: z.number().int().positive(),
    startedAt: z.string().datetime(),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    protocol: z.enum(["http", "https"]),
    tokenPath: z.string().min(1).max(4_096),
    roots: z.array(z.string().min(1).max(4_096)).max(64),
  })
  .strict();

export interface DaemonCommandOptions {
  cwd?: string;
  host?: string;
  port?: number;
  root?: string[];
  background?: boolean;
  json?: boolean;
  cert?: string;
  key?: string;
  taskId?: string;
  prompt?: string;
  taskCwd?: string;
  provider?: string;
  model?: string;
  agentProfile?: string;
  fullAccess?: boolean;
  after?: number;
  limit?: number;
  follow?: boolean;
  jsonl?: boolean;
  /** Explicit remote daemon URL; local metadata remains the default. */
  remoteUrl?: string;
  /** Environment variable containing a remote daemon bearer token. */
  tokenEnv?: string;
  jwks?: string;
  issuer?: string;
  audience?: string;
}

type DaemonAction =
  | "start"
  | "status"
  | "stop"
  | "tasks"
  | "submit"
  | "inspect"
  | "events"
  | "cancel"
  | "resume"
  | "remove"
  | "audit";

/** Manage the durable authenticated Orbit task daemon. */
export async function runDaemonCommand(
  action: DaemonAction,
  options: DaemonCommandOptions = {},
): Promise<number> {
  const daemonRoot = resolve(options.cwd ?? homedir(), DAEMON_ROOT_NAME);
  const metadataPath = join(daemonRoot, "daemon.json");
  const tokenPath = join(daemonRoot, "token");
  if (action === "start") {
    return startDaemon(daemonRoot, metadataPath, tokenPath, options);
  }
  if (options.remoteUrl) {
    return runRemoteDaemonCommand(action, options);
  }
  const metadata = readMetadata(metadataPath, tokenPath);
  if (!metadata) {
    printDaemonResult(options.json, {
      ok: false,
      error: "Daemon is not running.",
    });
    return 1;
  }
  const token = new DaemonTokenStore(metadata.tokenPath).loadExisting();
  const base = `${metadata.protocol}://${formatHost(metadata.host)}:${metadata.port}`;
  if (action === "audit") {
    const response = await daemonFetch(
      `${base}/v1/audit?limit=${options.limit ?? 500}`,
      token,
    );
    printDaemonResult(options.json, response.body);
    return isSuccess(response.status) ? 0 : 1;
  }
  if (action === "submit") {
    const prompt = options.prompt?.trim();
    if (!prompt) throw new Error("Daemon submit requires a non-empty prompt.");
    const response = await daemonFetch(`${base}/v1/tasks`, token, {
      method: "POST",
      body: JSON.stringify({
        cwd: resolve(options.taskCwd ?? process.cwd()),
        prompt,
        options: {
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.agentProfile
            ? { agentProfile: options.agentProfile }
            : {}),
          fullAccess: !!options.fullAccess,
          fullAccessConfirmed: !!options.fullAccess,
        },
      }),
    });
    printDaemonResult(options.json, response.body);
    return isSuccess(response.status) ? 0 : 1;
  }
  if (["inspect", "events", "cancel", "resume", "remove"].includes(action)) {
    const taskId = options.taskId?.trim();
    if (!taskId) throw new Error(`Daemon ${action} requires a task id.`);
    if (action === "events") {
      return streamDaemonEvents(base, token, taskId, options);
    }
    const suffix =
      action === "inspect" || action === "remove" ? "" : `/${action}`;
    const response = await daemonFetch(
      `${base}/v1/tasks/${taskId}${suffix}`,
      token,
      action === "inspect"
        ? {}
        : action === "remove"
          ? { method: "DELETE" }
          : { method: "POST", body: "{}" },
    );
    printDaemonResult(options.json, response.body);
    return isSuccess(response.status) ? 0 : 1;
  }
  if (action === "stop") {
    const response = await daemonFetch(`${base}/v1/shutdown`, token, {
      method: "POST",
      body: "{}",
    });
    printDaemonResult(options.json, response.body);
    return isSuccess(response.status) ? 0 : 1;
  }
  const path =
    action === "tasks"
      ? `/v1/tasks?limit=${options.limit ?? 100}`
      : "/v1/health";
  const response = await daemonFetch(`${base}${path}`, token);
  printDaemonResult(options.json, response.body);
  return isSuccess(response.status) ? 0 : 1;
}

/** Run daemon controls against an explicitly selected remote host. */
async function runRemoteDaemonCommand(
  action: Exclude<DaemonAction, "start">,
  options: DaemonCommandOptions,
): Promise<number> {
  const baseUrl = validateRemoteDaemonUrl(options.remoteUrl!);
  const tokenEnv = z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]{0,127}$/)
    .parse(options.tokenEnv ?? "ORBIT_DAEMON_TOKEN");
  const token = process.env[tokenEnv];
  if (!token) throw new Error(`Missing remote daemon token in ${tokenEnv}.`);
  const client = new DaemonClient({ baseUrl, token });

  if (action === "status") {
    printDaemonResult(options.json, await client.health());
    return 0;
  }
  if (action === "tasks") {
    const tasks = await client.listTasks(options.limit ?? 100);
    printDaemonResult(options.json, { schemaVersion: 1, ok: true, tasks });
    return 0;
  }
  if (action === "audit") {
    printDaemonResult(options.json, {
      schemaVersion: 1,
      ok: true,
      ...(await client.readAudit(options.limit ?? 500)),
    });
    return 0;
  }
  if (action === "submit") {
    const prompt = options.prompt?.trim();
    if (!prompt) throw new Error("Daemon submit requires a non-empty prompt.");
    const taskCwd = options.taskCwd?.trim();
    if (!taskCwd) {
      throw new Error(
        "Remote daemon submit requires --cwd using a remote-visible path.",
      );
    }
    const task = await client.startTask({
      cwd: taskCwd,
      prompt,
      options: {
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.agentProfile ? { agentProfile: options.agentProfile } : {}),
        fullAccess: !!options.fullAccess,
        fullAccessConfirmed: !!options.fullAccess,
      },
    });
    printDaemonResult(options.json, { schemaVersion: 1, ok: true, task });
    return 0;
  }
  if (action === "stop") {
    await client.shutdown();
    printDaemonResult(options.json, { schemaVersion: 1, ok: true });
    return 0;
  }

  const taskId = DaemonTaskIdSchema.parse(options.taskId?.trim());
  if (action === "inspect") {
    const task = await client.getTask(taskId);
    printDaemonResult(options.json, { schemaVersion: 1, ok: true, task });
    return 0;
  }
  if (action === "events") {
    if (options.json && options.follow) {
      throw new Error("Use --jsonl, not --json, when following daemon events.");
    }
    if (options.follow) {
      await client.followEvents(
        taskId,
        (event) => {
          if (options.jsonl) console.log(JSON.stringify(event));
          else printDaemonEvent(event);
        },
        { after: options.after ?? 0, limit: options.limit ?? 200 },
      );
      return 0;
    }
    const page = await client.readEvents(taskId, {
      after: options.after ?? 0,
      limit: options.limit ?? 200,
    });
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            schemaVersion: 1,
            taskId,
            events: page.events,
            resyncRequired: page.resyncRequired,
          },
          null,
          2,
        ),
      );
    } else if (options.jsonl) {
      for (const event of page.events) console.log(JSON.stringify(event));
    } else {
      for (const event of page.events) printDaemonEvent(event);
    }
    return 0;
  }
  if (action === "cancel" || action === "resume") {
    const task =
      action === "cancel"
        ? await client.cancelTask(taskId)
        : await client.resumeTask(taskId);
    printDaemonResult(options.json, { schemaVersion: 1, ok: true, task });
    return 0;
  }
  if (action === "remove") {
    const removed = await client.removeTask(taskId);
    printDaemonResult(options.json, { schemaVersion: 1, ok: true, removed });
    return 0;
  }
  throw new Error(`Unsupported remote daemon action: ${action}.`);
}

function validateRemoteDaemonUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password) {
    throw new Error("Remote daemon URL cannot contain credentials.");
  }
  const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback.has(parsed.hostname))
  ) {
    throw new Error(
      "Remote daemon URLs must use HTTPS; HTTP is allowed only for loopback.",
    );
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function startDaemon(
  daemonRoot: string,
  metadataPath: string,
  tokenPath: string,
  options: DaemonCommandOptions,
): Promise<number> {
  const existing = readMetadata(metadataPath, tokenPath);
  if (existing) {
    try {
      const existingToken = new DaemonTokenStore(
        existing.tokenPath,
      ).loadExisting();
      const health = await daemonFetch(
        `${existing.protocol}://${formatHost(existing.host)}:${existing.port}/v1/health`,
        existingToken,
      );
      if (health.status >= 200 && health.status < 300) {
        printDaemonResult(options.json, {
          ok: false,
          error: `Daemon is already running on ${existing.host}:${existing.port}.`,
        });
        return 1;
      }
    } catch {
      // A stale marker is replaced only after the authenticated health probe
      // cannot reach the recorded listener.
    }
    replacePrivateFileAtomically(metadataPath, "{}\n");
  }
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const configuredRoots = normalizeRootList(options.root);
  const roots = (
    configuredRoots.length ? configuredRoots : [process.cwd()]
  ).map((root) => resolve(root));
  if (options.background) {
    const entry = process.argv[1];
    if (!entry)
      throw new Error(
        "Orbit daemon cannot determine its executable entry point.",
      );
    const childArgs = [
      entry,
      "daemon",
      "start",
      "--host",
      host,
      "--port",
      String(port),
    ];
    for (const root of roots) childArgs.push("--root", root);
    if (options.cert && options.key) {
      childArgs.push("--cert", options.cert, "--key", options.key);
    }
    if (options.jwks && options.issuer && options.audience) {
      childArgs.push(
        "--jwks",
        options.jwks,
        "--issuer",
        options.issuer,
        "--audience",
        options.audience,
      );
    }
    const child = spawn(process.execPath, childArgs, {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
      detached: true,
      stdio: "ignore",
      env: buildInheritedChildEnvironment(),
    });
    child.unref();
    printDaemonResult(options.json, {
      ok: true,
      state: "starting",
      pid: child.pid,
    });
    return 0;
  }

  ensurePrivateDirectory(daemonRoot);
  const tokenStore = new DaemonTokenStore(tokenPath);
  const runner: DaemonTaskRunner = {
    run: (task, emit, signal) => runChildTask(task, emit, signal),
  };
  const authenticator = createDaemonAuthenticator(options);
  const server = new DaemonServer({
    store: new DaemonStore(join(daemonRoot, "state")),
    tokenStore,
    runner,
    host,
    port,
    allowedRoots: roots,
    ...(options.cert && options.key
      ? { tls: { certFile: options.cert, keyFile: options.key } }
      : {}),
    ...(authenticator ? { authenticators: [authenticator] } : {}),
    auditLog: new DaemonAuditLog("audit/events.jsonl", daemonRoot),
    requireAudit: true,
  });
  const address = await server.start();
  const metadata: DaemonMetadata = {
    schemaVersion: DAEMON_METADATA_SCHEMA_VERSION,
    protocolVersion: 1,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: address.host,
    port: address.port,
    protocol: address.protocol,
    tokenPath,
    roots,
  };
  replacePrivateFileAtomically(
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  printDaemonResult(options.json, { ok: true, state: "running", metadata });
  const stop = async () => {
    await server.stop();
    try {
      if (existsSync(metadataPath))
        replacePrivateFileAtomically(metadataPath, "{}\n");
    } catch {
      // A stopped daemon must never fail merely because its status marker is stale.
    }
  };
  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
  await server.waitForStop();
  await stop();
  return 0;
}

function createDaemonAuthenticator(
  options: DaemonCommandOptions,
): JwtDaemonAuthenticator | undefined {
  if (!options.jwks && !options.issuer && !options.audience) return undefined;
  if (!options.jwks || !options.issuer || !options.audience) {
    throw new Error(
      "Daemon JWT identity requires --jwks, --issuer, and --audience together.",
    );
  }
  const raw = readBoundedRegularFile(resolve(options.jwks), 2 * 1024 * 1024);
  if (!raw) throw new Error(`Daemon JWKS file was not found: ${options.jwks}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Daemon JWKS file is not valid JSON.");
  }
  const keys = Array.isArray((parsed as { keys?: unknown })?.keys)
    ? (parsed as { keys: unknown[] }).keys
    : [];
  const mapped: Record<
    string,
    { kty: "RSA"; n: string; e: string; alg?: "RS256"; use?: "sig" }
  > = {};
  for (const key of keys) {
    if (!isRecord(key) || typeof key.kid !== "string" || key.kid.length > 128)
      continue;
    if (
      key.kty !== "RSA" ||
      typeof key.n !== "string" ||
      typeof key.e !== "string"
    )
      continue;
    if (key.alg !== undefined && key.alg !== "RS256") continue;
    if (key.use !== undefined && key.use !== "sig") continue;
    mapped[key.kid] = {
      kty: "RSA",
      n: key.n,
      e: key.e,
      ...(key.alg ? { alg: "RS256" } : {}),
      ...(key.use ? { use: "sig" } : {}),
    };
  }
  if (Object.keys(mapped).length === 0)
    throw new Error("Daemon JWKS contains no supported RSA signing keys.");
  return new JwtDaemonAuthenticator({
    issuer: options.issuer,
    audience: options.audience,
    keys: mapped,
  });
}

async function runChildTask(
  task: DaemonTaskRecord,
  emit: (type: string, payload?: Record<string, unknown>) => void,
  signal: AbortSignal,
): Promise<{
  state: "completed" | "failed" | "aborted";
  exitCode?: number;
  error?: string;
  sessionId?: string;
}> {
  const entry = process.argv[1];
  if (!entry)
    return {
      state: "failed",
      error: "Orbit daemon cannot locate the CLI entry point.",
    };
  const args = [entry, "exec", task.prompt, "--jsonl"];
  if (task.options.provider) args.push("--provider", task.options.provider);
  if (task.options.model) args.push("--model", task.options.model);
  if (task.options.agentProfile)
    args.push("--agent-profile", task.options.agentProfile);
  if (task.options.resumeSessionId || task.sessionId) {
    args.push("--resume", task.options.resumeSessionId || task.sessionId || "");
  }
  if (task.options.fullAccess) args.push("--yes");

  const child = spawn(process.execPath, args, {
    ...HIDDEN_CHILD_PROCESS_OPTIONS,
    cwd: task.cwd,
    env: buildInheritedChildEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdoutBuffer = "";
  let terminalStatus: "completed" | "failed" | "aborted" | undefined;
  let sessionId: string | undefined;
  let spawnError: string | undefined;
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16_000);
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as {
          type?: unknown;
          payload?: unknown;
        };
        if (typeof event.type !== "string") continue;
        const payload = isRecord(event.payload) ? event.payload : {};
        emit(event.type, payload);
        if (event.type === "agent_completed") {
          const result = isRecord(payload.result) ? payload.result : {};
          if (typeof result.sessionId === "string")
            sessionId = result.sessionId;
          if (isRecord(result) && typeof result.status === "string") {
            if (
              result.status === "completed" ||
              result.status === "failed" ||
              result.status === "aborted"
            ) {
              terminalStatus = result.status;
            }
          }
        }
      } catch {
        // JSONL is a versioned best-effort stream; malformed child noise is
        // retained only in bounded stderr diagnostics, never executed.
      }
    }
  });
  const abortHandler = () => {
    void terminateChildTree(child.pid);
  };
  signal.addEventListener("abort", abortHandler, { once: true });
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolvePromise) => {
    child.once("exit", (code, exitSignal) =>
      resolvePromise({ code, signal: exitSignal }),
    );
    child.once("error", (error) => {
      spawnError = redactSecrets(error.message).slice(0, 4_000);
      resolvePromise({ code: 1, signal: null });
    });
  });
  signal.removeEventListener("abort", abortHandler);
  const exitCode = result.code ?? (result.signal ? 1 : 0);
  if (signal.aborted)
    return { state: "aborted", exitCode, error: "Daemon task canceled." };
  if (terminalStatus === "completed" && exitCode === 0)
    return { state: "completed", exitCode, sessionId };
  return {
    state: terminalStatus === "aborted" ? "aborted" : "failed",
    exitCode,
    error: redactSecrets(
      spawnError || stderr || `Orbit child exited with code ${exitCode}.`,
    ).slice(0, 4_000),
    sessionId,
  };
}

async function terminateChildTree(pid: number | undefined): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      ...HIDDEN_CHILD_PROCESS_OPTIONS,
    }).catch(() => undefined);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The child already exited.
  }
}

function readMetadata(
  path: string,
  expectedTokenPath: string,
): DaemonMetadata | undefined {
  const raw = readBoundedRegularFile(path, MAX_METADATA_BYTES);
  if (!raw) return undefined;
  try {
    const parsed = DaemonMetadataSchema.parse(JSON.parse(raw));
    if (resolve(parsed.tokenPath) !== resolve(expectedTokenPath))
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function daemonFetch(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const body = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid daemon response." }));
  return { status: response.status, body };
}

async function streamDaemonEvents(
  base: string,
  token: string,
  taskId: string,
  options: DaemonCommandOptions,
): Promise<number> {
  if (options.json && options.follow) {
    throw new Error("Use --jsonl, not --json, when following daemon events.");
  }
  const query = new URLSearchParams({
    after: String(options.after ?? 0),
    limit: String(options.limit ?? 200),
    follow: options.follow ? "true" : "false",
  });
  const response = await fetch(`${base}/v1/tasks/${taskId}/events?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ ok: false, error: "Invalid daemon response." }));
    printDaemonResult(options.json || options.jsonl, body);
    return 1;
  }
  if (!response.body) throw new Error("Daemon event response has no body.");

  const events: unknown[] = [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const frames = buffer.split("\n\n");
    buffer = done ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      const event = parseDaemonSseFrame(frame);
      if (event === undefined) continue;
      if (options.json) events.push(event);
      else if (options.jsonl) console.log(JSON.stringify(event));
      else printDaemonEvent(event);
    }
    if (done) break;
  }
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, taskId, events }, null, 2));
  }
  return 0;
}

function parseDaemonSseFrame(frame: string): unknown | undefined {
  const eventName = frame
    .split("\n")
    .find((line) => line.startsWith("event:"))
    ?.slice(6)
    .trim();
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  try {
    const parsed = JSON.parse(data) as unknown;
    if (eventName && isRecord(parsed) && typeof parsed.type !== "string") {
      return { ...parsed, type: eventName };
    }
    return parsed;
  } catch {
    return {
      schemaVersion: 1,
      type: "invalid_event",
      data: redactSecrets(data),
    };
  }
}

function printDaemonEvent(value: unknown): void {
  if (!isRecord(value)) {
    console.log(picocolors.gray(`● ${String(value)}`));
    return;
  }
  const sequence =
    typeof value.sequence === "number" ? `#${value.sequence}` : "●";
  const type = typeof value.type === "string" ? value.type : "daemon_event";
  const timestamp =
    typeof value.timestamp === "string" ? ` · ${value.timestamp}` : "";
  console.log(
    `${picocolors.cyan(sequence)} ${type}${picocolors.gray(timestamp)}`,
  );
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function printDaemonResult(json: boolean | undefined, value: unknown): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (isRecord(value) && value.ok === false) {
    const error = isRecord(value.error) ? value.error.message : value.error;
    console.error(
      picocolors.red(`✖ ${String(error ?? "Daemon request failed.")}`),
    );
    return;
  }
  console.log(picocolors.green(`✔ ${JSON.stringify(value)}`));
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRootList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    Array.isArray(item)
      ? item.filter((entry): entry is string => typeof entry === "string")
      : typeof item === "string"
        ? [item]
        : [],
  );
}
